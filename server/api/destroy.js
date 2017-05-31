"use strict";
const _ = require('lodash');
const async = require('async');

const MIN_HOURS = 40;

function destroy(req, res) {

    const email = _.get(req, 'body.email', '');
    const password = _.get(req, 'body.password', '');
    /**
     * @type {Harvest}
     */
    const harvest = _.get(req, 'app.locals.services.harvest');

    /**
     * @type {Slack}
     */
    const slack = _.get(req, 'app.locals.services.slack');

    res.send('Time bot preparing to destroy...');

    async.waterfall([

        (next) => {

            harvest.getAdmin(email, password, next);
        },
        (harvestAdmin, next) => {

            harvestAdmin.getDelinquents(MIN_HOURS, next);
        },
        (harvestDelinquents, next) => {

            slack.getUsers((err, slackUsers) => {

                next(err, harvestDelinquents, slackUsers);
            });
        },
        (harvestDelinquents, slackUsers, next) => {

            const harvestLink = harvest.getWeeklyUrl();

            async.each(harvestDelinquents, (harvestDelinquent, callback) => {

                const harvestUserEmail = _.get(harvestDelinquent, 'user.email', '');

                const copyLink = req.app.locals.services.appUrl('copy');
                const message = `${harvestDelinquent.getName()}, you have not logged 40 hours this week on Harvest. <${harvestLink}|Use a blank timesheet>, or <${copyLink}|copy hours from last week>.`;

                slack.messageUserByEmail(harvestUserEmail, message, slackUsers, (err) => {

                    if (err) {
                        // TODO: email these people.
                    }
                    callback();
                });

            }, (err) => {

                const reallyBadPeople = [];

                _.forEach(harvestDelinquents, (harvestDelinquent) => {

                    if (harvestDelinquent.hours === 0) {
                        reallyBadPeople.push(harvestDelinquent.getName());
                    }
                });

                next(err, reallyBadPeople);
            });
        },
        (reallyBadPeople, next) => {

            const badMessage = `${reallyBadPeople.join(', ')} won't be getting ice cream today. I will also be replacing their photos on our website with mustached versions. If you already have a mustache, I will replace with a shaved version. I will also use your Netflix accounts to watch shows that are the exact opposite of your taste preferences so that you will forevermore get recommendations for "Ancient Aliens" and the bootleg versions of the "Fast and Furious" movies.`;
            const goodMessage = 'OMGWTFBBQ EVERYONE SUBMITTED THEIR TIMESHEETS!';
            const message = reallyBadPeople.length ? badMessage : goodMessage;

            slack.messageChannel(message, slack.generalChannel, next);
        }
    ]);

}

module.exports = destroy;
