"use strict";

const fs = require('fs');
const _ = require('lodash');
const async = require('async');
const request = require('request');
const moment = require('moment');

const express = require('express');
const bodyParser = require('body-parser');

const SLACK_API_URL = process.env.SLACK_API_URL;
const SLACK_GENERAL_CHANNEL = process.env.SLACK_GENERAL_CHANNEL;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const HARVEST_API_URL = process.env.HARVEST_API_URL;

const MIN_HOURS = 40;

const app = express();

app.use(bodyParser.urlencoded({
    extended: false
}));

/**
 * Load the homepage.
 */
app.get('/', function (req, res) {

    fs.readFile('./homepage.html', (err, html) => {
        if (err) {
            throw err;
        }
        res.set('Content-Type', 'text/html');
        res.send(html);
    });
});

/**
 * Send a warning message.
 */
app.post('/warn', function(req, res) {

    const email = _.get(req, 'body.email', '');
    const password = _.get(req, 'body.password', '');

    async.series([
        /**
         * Are you authorized?
         *
         * @param next
         */
        (next) => {

            authorized(email, password, next);
        },
        /**
         * Send a message to the general channel.
         *
         * @param next
         */
        (next) => {

            const message = "Warning! If you have not submitted your timesheets, please do so now: <https://domandtom.harvestapp.com/time/week>\nI'll be back.";

            messageChannel(message, SLACK_GENERAL_CHANNEL, next);
        }
    ], (err) => {

        if (err) {
            return res.send('An error occurred. Sorry.');
        }

        res.send('Warning sent.');
    });
});

/**
 * Send individual messages to delinquents.
 */
app.post('/destroy', function (req, res) {

    const email = _.get(req, 'body.email', '');
    const password = _.get(req, 'body.password', '');

    async.waterfall([
        /**
         * Are you authorized?
         *
         * @param next
         */
        (next) => {

            authorized(email, password, next);
        },
        /**
         * Fetch all users from Harvest that are active.
         *
         * @param next
         */
        (next) => {

            getHarvestUsers(email, password, next);
        },
        /**
         * Filter the harvest users that are delinquents.
         *
         * @param {[{}]} harvestUsers
         * @param next
         */
        (harvestUsers, next) => {

            getHarvestDelinquents(email, password, harvestUsers, next);
        },
        /**
         * Get all slack users.
         *
         * @param {[{}]} harvestDelinquents
         * @param next
         */
        (harvestDelinquents, next) => {

            getSlackUsers((err, slackUsers) => {

                next(err, harvestDelinquents, slackUsers);
            });
        },
        /**
         * Message each delinquent on slack.
         *
         * @param {[{}]} harvestDelinquents
         * @param {[{}]} slackUsers
         * @param next
         */
        (harvestDelinquents, slackUsers, next) => {

        async.each(harvestDelinquents, (harvestUser, callback) => {

            messageSlackUserFromHarvestUser(harvestUser, slackUsers, (err) => {

                if (err) {
                    // TODO: send email.
                }
                callback();
            });

        }, (err) => {
            /**
             * Create an array of harvest users' names.
             */
            next(err, _.map(harvestDelinquents, (harvestUser) => {

                return `${_.get(harvestUser, 'first_name', '')} ${_.get(harvestUser, 'last_name', '')}`;
            }));
        });
        },
        /**
         * Send a message to the general channel about the remaining delinquents.
         *
         * @param delinquents
         * @param next
         */
        (delinquents, next) => {

            const badMessage = `Everyone, please publicly shame the following people for not submitting their timesheets: ${delinquents.join(', ')}\nHasta la vista, baby.:sunglasses: :tom:`;
            const goodMessage = 'OMGWTFBBQ EVERYONE SUBMITTED THEIR TIMESHEETS!';
            const message = delinquents.length ? badMessage : goodMessage;

            messageChannel(message, SLACK_GENERAL_CHANNEL, next);
        }
    ], (err) => {

        if (err) {
            return res.send(err.message || 'Something went horribly wrong.');
        }
        res.send('Time bot destroyed.');
    });

});

/**
 * Start the server.
 */
app.listen(process.env.PORT || 3000, function() {
    console.log('Listening.');
});

/**
 * Get all Harvest users.
 *
 * @param {string} email
 * @param {string} password
 * @param callback
 */
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

        callback(err, _.map(usersWrapper || [], (userWrapper) => {

            return _.get(userWrapper, 'user', {});
        }));
    });

}

/**
 * Get only users that are active and have less than MIN_HOURS.
 *
 * @param {string} email
 * @param {string} password
 * @param {[{}]} harvestUsers
 * @param callback
 */
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

/**
 *
 *
 * @param {string} email
 * @param {string} password
 * @param {string|number} userId
 * @param callback
 */
function getHarvestUserHours(email, password, userId, callback) {

    const today = moment();
    const todayId = today.day();

    if (todayId <= 1) { // its monday or sunday
        today.subtract(2 + todayId, 'days'); // go back to last friday
    }

    /**
     * Start at the beginning of the week.
     *
     * @type {moment.Moment}
     */
    const monday = today.clone().startOf('week').add(1, 'day');

    let hours = 0;

    async.whilst(
        /**
         * Start from friday, and move up to monday.
         *
         * @returns {boolean}
         */
        () => {
            return today.isSameOrAfter(monday, 'date');
        },
        /**
         * Get the timesheets for a  user for a particular day.
         *
         * @param callback
         */
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
                /**
                 * Add up the hours and add it to the total.
                 *
                 */
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

/**
 * Get all slack users.
 *
 * @param callback
 */
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

/**
 * Messages a harvest user on slack by matching their email addresses.
 *
 * @param {{}} harvestUser
 * @param {[{}]} slackUsers
 * @param callback
 * @returns {*}
 */
function messageSlackUserFromHarvestUser(harvestUser, slackUsers, callback) {

    /**
     * Find the slack user corresponding to the harvest user via their email.
     */
    const slackUser = _.find(slackUsers, (slackUser) => {

        const harvestUserEmail = _.get(harvestUser, 'email', '').toLowerCase();
        return harvestUserEmail && (harvestUserEmail === _.get(slackUser, 'profile.email', '').toLowerCase());
    });

    if (!slackUser) {
        return callback(harvestUser);
    }

    const message = 'You have not submitted 40 hours this week! Please do so now: https://domandtom.harvestapp.com/time/week';
    const channel = _.get(slackUser, 'id');

    messageChannel(message, channel, callback);
}

/**
 * Send a message to a slack channel.
 *
 * @param {string} message
 * @param {string} channel
 * @param callback
 */
function messageChannel(message, channel, callback) {

    const options = {
        url: 'chat.postMessage',
        qs: {
            token: SLACK_TOKEN,
            channel: channel,
            as_user: true,
            text: message
        },
        baseUrl: SLACK_API_URL,
        json: true
    };

    request(options, (err, response, body) => {

        callback(err, body);
    });

}

/**
 * Checks harvest for the person who's logged in, then checks if they belong to D&T and are an admin.
 *
 * @param {string} email
 * @param {string} password
 * @param callback
 */
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