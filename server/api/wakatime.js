"use strict";
const _ = require('lodash');
const async = require('async');
const url = require('url');

function wakatime(req, res) {

    const harvestAccessToken = _.get(req, 'query.harvest_access_token', _.get(req, 'cookies.harvest_access_token', ''));
    const harvestRefreshToken = _.get(req, 'cookies.harvest_refresh_token', '');
    const wakatimeAccessToken = _.get(req, 'query.wakatime_access_token', _.get(req, 'cookies.wakatime_access_token', ''));

    /**
     * @type {Harvest}
     */
    const harvest = _.get(req, 'app.locals.services.harvest');

    /**
     *
     * @type {WakaTime}
     */
    const wakatime = _.get(req, 'app.locals.services.wakatime');

    async.waterfall([

        (next) => {

            harvest.getUser(harvestAccessToken, harvestRefreshToken, (err, harvestUser) => {

                if (err) {
                    return next('harvest_auth');
                }

                res.cookie('harvest_access_token', harvestUser.accessToken || '');
                res.cookie('harvest_refresh_token', harvestUser.refreshToken || '');

                next(err, harvestUser);
            });
        },
        (harvestUser, next) => {

            wakatime.getUser(wakatimeAccessToken, (err, wakatimeUser) => {

                if (err) {
                    return next('wakatime_auth');
                }
                next(err, harvestUser, wakatimeUser);
            });
        },
        (harvestUser, wakatimeUser, next) => {

            harvestUser.getProjects((err, harvestProjects) => {

                next(err, harvestUser, wakatimeUser, harvestProjects, next);
            });
        },
        (harvestUser, wakatimeUser, harvestProjects, next) => {

            wakatimeUser.getDurationsByProjectForLatestWeek((day, durationsByProject, callback) => {

                const pick = new Set();
                const harvestProjectIds = {};
                _.forEach(harvestProjects, (harvestProject) => {

                    harvestProjectIds[harvestProject.name] = harvestProject.id;

                    if (durationsByProject[harvestProject.name]) {
                        pick.add(harvestProject.name);
                    }
                });

                durationsByProject = _.pick(durationsByProject, Array.from(pick));

                harvestUser.getTimesheetsForDay(day, (err, timesheets) => {

                    if (err) {
                        return callback(err);
                    }
                    const omit = new Set();
                    _.forEach(timesheets, (timesheet) => {

                        if (durationsByProject[timesheet.project]) {

                            omit.add(timesheet.project);
                        }
                    });
                    durationsByProject = _.omit(durationsByProject, Array.from(omit));

                    async.each(Object.keys(durationsByProject), (project, callback) => {

                        harvestUser.createTimesheet(day, harvestProjectIds[project])

                    }, callback);
                });

            }, next);
        }

    ], (err) => {

    });

}

module.exports = wakatime;