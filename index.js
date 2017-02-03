"use strict";

const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const async = require('async');
const request = require('request');
const moment = require('moment');
const _ = require('lodash');

const SLACK_API_URL = process.env.SLACK_API_URL;
const SLACK_GENERAL_CHANNEL = process.env.SLACK_GENERAL_CHANNEL;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const HARVEST_API_URL = process.env.HARVEST_API_URL;

const MIN_HOURS = 40;

const app = express();

app.use(bodyParser.urlencoded({
    extended: true
}));

app.get('/', function (req, res) {

    fs.readFile('./homepage.html', function (err, html) {
        if (err) {
            throw err;
        }
        res.set('Content-Type', 'text/html');
        res.send(html);
    });
});

app.post('/warn', function(req, res) {

    const email = req.body.email;
    const password = req.body.password;

    authorized(email, password, (err) => {

        if (err) {

            return res.send('Not authorized.');
        }

        const options = {
            url: 'chat.postMessage',
            qs: {
                token: SLACK_TOKEN,
                channel: SLACK_GENERAL_CHANNEL,
                as_user: true,
                text: 'Warning! if you have not submitted your timesheets, please do so now: https://domandtom.harvestapp.com/time/week'
            },
            baseUrl: SLACK_API_URL,
            json: true
        };

        request(options, (err, response, body) => {

            if (err) {
                return res.send('An error occurred. Sorry.');
            }
            res.send('Warning sent.');
        });
    });
});

app.post('/destroy', function (req, res) {

    const email = req.body.email;
    const password = req.body.password;

    async.waterfall([
        (next) => {

            authorized(email, password, next);
        },
        (next) => {

            getHarvestUsers(email, password, next);
        },
        (harvestUsers, next) => {

            getHarvestDelinquents(email, password, harvestUsers, next);
        },
        (harvestDelinquents, next) => {

            getSlackUsers((err, slackUsers) => {

                next(err, harvestDelinquents, slackUsers);
            });
        },
        (harvestDelinquents, slackUsers, next) => {

        async.each(harvestDelinquents, (harvestUser, callback) => {

            messageSlackUserFromHarvestUser(harvestUser, slackUsers, (err) => {

                if (err) {
                    // send email.
                }

                callback();
            });

        }, (err) => {

            next(err, _.map(harvestDelinquents, (harvestUser) => {

                return `${_.get(harvestUser, 'first_name', '')} ${_.get(harvestUser, 'last_name', '')}`;
            }));
        });
        }
    ], (err, delinquents) => {

        if (err) {
            return res.send(err.message || 'Something went horribly wrong.');
        }

        const message = `Everyone, please publicly shame the following people for not submitting their timesheets: ${delinquents.join(', ')}`;

        const options = {
            url: 'chat.postMessage',
            qs: {
                token: SLACK_TOKEN,
                channel: SLACK_GENERAL_CHANNEL,
                as_user: true,
                text: message
            },
            baseUrl: SLACK_API_URL,
            json: true
        };

        request(options, (err, response, body) => {

            if (err) {
                return res.send(err.message || 'Something went horribly wrong.');
            }
            res.send('Time bot destroyed.');
        });
    });

});


app.listen(process.env.PORT || 3000, function() {
    console.log('Listening.');
});

function getHarvestUsers(email, password, callback) {

    const options = {
        url: '/people',
        baseUrl: HARVEST_API_URL,
        auth: {
            user: email,
            pass: password
        },
        json: true
    };

    request(options, (err, response, usersWrapper) => {

        callback(err, _.map(usersWrapper, (userWrapper) => {

            return _.get(userWrapper, 'user', {});
        }));
    });

}

function getHarvestDelinquents(email, password, harvestUsers, callback) {

    async.filter(harvestUsers, (user, callback) => {

        if (!user.is_active) {
            return callback(null, false);
        }

        getHarvestUserHours(email, password, user.id, (err, hours) => {

            callback(err, hours < MIN_HOURS);
        });

    }, callback);
}


function getHarvestUserHours(email, password, userId, callback) {

    const today = moment();

    if (today.day() === 1) { // its monday
        today.subtract(3, 'days'); // go back to last friday
    }

    const monday = today.clone().startOf('week').add(1, 'day');

    let hours = 0;

    async.whilst(
        () => {
            return today.isSameOrAfter(monday, 'date');
        },
        (callback) => {

            const options = {
                url: `/daily/${today.dayOfYear()}/${today.year()}`,
                qs: {
                    slim: 1,
                    of_user: userId
                },
                baseUrl: HARVEST_API_URL,
                auth: {
                    user: email,
                    pass: password
                },
                json: true
            };

            request(options, (err, response, body) => {

                if (err) {
                    return callback(err);
                }

                const timesheetsForDay = _.get(body, 'day_entries', []);
                hours+= _.reduce(timesheetsForDay, (sum, timesheet) => {
                    return sum + _.get(timesheet, 'hours', 0);
                }, 0);

                today.subtract(1, 'day');
                callback();
            });

        },
        (err) => {

            callback(err, hours);
        }
    );
}

function getSlackUsers(callback) {

    const options = {
        url: 'users.list',
        qs: {
            token: SLACK_TOKEN
        },
        baseUrl: SLACK_API_URL,
        json: true
    };

    request(options, (err, response, body) => {

        callback(err, _.get(body, 'members', []));
    });
}

function messageSlackUserFromHarvestUser(harvestUser, slackUsers, callback) {

    const slackUser = _.find(slackUsers, (slackUser) => {

        const harvestUserEmail = _.get(harvestUser, 'email', '').toLowerCase();
        return harvestUserEmail && (harvestUserEmail === _.get(slackUser, 'profile.email', '').toLowerCase());
    });

    if (!slackUser) {
        return callback(harvestUser);
    }

    const channel = _.get(slackUser, 'id');
    //const channel = SLACK_GENERAL_CHANNEL;

    const options = {
        url: 'chat.postMessage',
        qs: {
            token: SLACK_TOKEN,
            channel: channel,
            as_user: true,
            text: 'You have not submitted 40 hours this week! Please do so now: https://domandtom.harvestapp.com/time/week'
        },
        baseUrl: SLACK_API_URL,
        json: true
    };

    request(options, (err, response, body) => {

        callback(err, body);
    });
}

function authorized(email, password, callback) {

    const options = {
        url: '/account/who_am_i',
        baseUrl: HARVEST_API_URL,
        auth: {
            user: email,
            pass: password
        },
        json: true
    };

    request(options, (err, response, body) => {

        const email = _.get(body, 'user.email', '').toLowerCase();
        const isAdmin = _.get(body, 'user.admin', false);

        if (!(_.endsWith(email, '@domandtom.com') && isAdmin)) {

            return callback(new Error('Not authorized.'));
        }
        callback();
    });

}