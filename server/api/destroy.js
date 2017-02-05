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

            const message = 'You have not submitted 40 hours this week! Please do so now: https://domandtom.harvestapp.com/time/week';

            async.each(harvestDelinquents, (harvestUser, callback) => {

                const harvestUserEmail = _.get(harvestUser, 'email', '');

                slack.messageUserByEmail(harvestUserEmail, message, slackUsers, (err) => {

                    if (err) {
                        // TODO: email
                    }
                    callback();
                });

            }, (err) => {
                /**
                 * Create an array of harvest users' names.
                 */
                const delinquents = _.map(harvestDelinquents, (harvestUser) => {

                    return `${_.get(harvestUser, 'first_name', '')} ${_.get(harvestUser, 'last_name', '')}`;
                });

                next(err, delinquents);
            });
        },
        (delinquents, next) => {

            const badMessage = `Everyone, please publicly shame the following people for not submitting their timesheets: ${delinquents.join(', ')}\nHasta la vista, baby.:sunglasses: :tom:`;
            const goodMessage = 'OMGWTFBBQ EVERYONE SUBMITTED THEIR TIMESHEETS!';
            const message = delinquents.length ? badMessage : goodMessage;

            slack.messageChannel(message, slack.generalChannel, next);
        }
    ], (err) => {

        if (err) {
            return res.send(err.message || 'Something went horribly wrong.');
        }
        res.send('Time bot destroyed.');
    });

}

module.exports = destroy;
