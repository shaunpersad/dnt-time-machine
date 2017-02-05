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

            const message = "Warning! If you have not submitted your timesheets, please do so now: <https://domandtom.harvestapp.com/time/week>\nI'll be back.";

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
