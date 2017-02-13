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
            const message = `Warning! If you have not submitted your timesheets, please do so now. You can either <${harvestLink}|use a blank timesheet> like a neanderthal, or <${copyLink}|copy hours from last week> like a champion lazy person.\n\nDon't make me find you.\n\nI'll be back.`;

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
