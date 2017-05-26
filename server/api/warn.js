"use strict";
const _ = require('lodash');
const async = require('async');

function warn(req, res) {

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

    async.series([

        (next) => {

            harvest.getAdmin(email, password, next);
        },
        (next) => {

            const harvestLink = harvest.getWeeklyUrl();
            const copyLink = req.app.locals.services.appUrl('copy');
            const message = `For Memorial Day, I want you to remember to do your timesheets. I won't be able to yell at you on Tuesday, because my creator did not code me with an understanding of holidays. <${harvestLink}|Use a blank timesheet>, or <${copyLink}|copy hours from last week.> Carry on, peasants.`;

            slack.messageChannel(message, slack.generalChannel, next);
        }
    ], (err) => {

        if (err) {
            return res.send(err.message || 'Something went horribly wrong.');
        }

        res.send('Warning sent.');
    });
}

module.exports = warn;
