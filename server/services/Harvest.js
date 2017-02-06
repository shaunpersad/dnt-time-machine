"use strict";
const _ = require('lodash');
const async = require('async');
const moment = require('moment-timezone');
const request = require('request');
const throttledQueue = require('throttled-queue');
const querystring = require('querystring');
const url = require('url');

const TIMEZONE = 'America/New_York';

class HarvestDelinquent {

    constructor(user, hours) {
        this.user = user;
        this.hours = hours;
    }

    getName() {
        return `${_.get(this.user, 'first_name', '')} ${_.get(this.user, 'last_name', '')}`;
    }
}

class HarvestUser {

    /**
     * @param {string} accessToken
     * @param {string} refreshToken
     * @param {string} userId
     * @param {Harvest} harvest
     */
    constructor(accessToken, refreshToken, userId, harvest) {

        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.id = userId;
        this.harvest = harvest;
    }

    /**
     * @param callback
     */
    getHoursForLatestWeek(callback) {

        const requestOptions = {
            qs: {
                access_token: this.accessToken
            }
        };

        this.harvest.getHoursForLatestWeek(requestOptions, callback);
    }

    copyPreviousWeekIntoLatest(callback) {

        const requestOptions = {
            qs: {
                access_token: this.accessToken
            }
        };
        const today = moment().tz(TIMEZONE);

        const todayId = today.day();

        if (todayId === 1) { // its monday
            today.subtract(1, 'day'); //
        }
        const lastWeekMonday = today.clone();

        /**
         * Start from last monday.
         */
        while(lastWeekMonday.day() !== 1) {
            lastWeekMonday.subtract(1, 'day');
        }

        /**
         * Go back one more week.
         */
        lastWeekMonday.subtract(1, 'week');

        const currentWeek = {};
        let numCreated = 0;

        this.harvest.getTimesheetsForDateRange(requestOptions, (day, timesheets, callback) => {

            const dayIndex = day.day();

            if (!currentWeek[dayIndex]) {
                currentWeek[dayIndex] = _.cloneDeep(timesheets);
                return callback();
            }
            const currentWeekTimesheets = currentWeek[dayIndex];

            async.each(timesheets, (lastWeekTimesheet, callback) => {

                const lastWeekProjectId = _.get(lastWeekTimesheet, 'project_id');
                const lastWeekTaskId = _.get(lastWeekTimesheet, 'task_id');
                const lastWeekHours = _.get(lastWeekTimesheet, 'hours', 0);

                if (!(lastWeekProjectId && lastWeekTaskId)) {
                    return callback();
                }

                const found = _.find(currentWeekTimesheets, (currentWeekTimesheet) => {

                    const currentWeekProjectId = _.get(currentWeekTimesheet, 'project_id');
                    const currentWeekTaskId = _.get(currentWeekTimesheet, 'task_id');

                    if (!(currentWeekProjectId && currentWeekTaskId)) {
                        return false;
                    }
                    return (lastWeekProjectId === currentWeekProjectId) && (lastWeekTaskId === currentWeekTaskId);
                });

                if (found) {
                    return callback();
                }

                this.createTimesheet(day.clone().add(1, 'week'), lastWeekProjectId, lastWeekTaskId, lastWeekHours, (err) => {

                    if (!err) {
                        numCreated++;
                    }

                    callback(err);
                });

            }, callback);

        }, lastWeekMonday, today, (err) => {

            callback(err, numCreated);
        });
    }

    createTimesheet(day, projectId, taskId, hours, callback) {

        const options = {
            url: '/daily/add',
            baseUrl: this.harvest.apiUrl,
            qs: {
                access_token: this.accessToken
            },
            method: 'POST',
            form: {
                spent_at: day.format('YYYY-M-D'),
                project_id: projectId,
                task_id: taskId,
                hours: hours
            },
            json: true
        };

        this.harvest.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && !_.get(body, 'id')) {
                    err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                }

                callback(err, body);
            });
        });
    }
}

class HarvestAdmin {

    /**
     *
     * @param {{}} auth
     * @param {Harvest} harvest
     */
    constructor(auth, harvest) {
        this.auth = auth;
        this.harvest = harvest;
    }

    /**
     * Gets all harvest users who have hours for the week less than the minimum
     * .
     * @param {number} minHours
     * @param callback
     */
    getDelinquents(minHours, callback) {

        async.waterfall([
            (next) => {
                this.getUsers(next);
            },
            (harvestUsers, next) => {

                const delinquents = [];

                async.each(harvestUsers, (harvestUser, callback) => {

                    if (!harvestUser.is_active) {
                        return callback();
                    }

                    this.getUserHoursForLatestWeek(harvestUser.id, (err, hours) => {

                        if (!err && (hours < minHours)) {
                            delinquents.push(new HarvestDelinquent(harvestUser, hours));
                        }
                        callback(err);
                    });

                }, (err) => {

                    next(err, delinquents)
                });
            }
        ], callback);
    }

    /**
     * Gets all Harvest users.
     *
     * @param callback
     */
    getUsers(callback) {

        const options = {
            url: '/people',
            baseUrl: this.harvest.apiUrl,
            auth: this.auth,
            json: true
        };

        this.harvest.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && response.statusCode != 200) {
                    err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                }

                callback(err, _.map(body || [], (userWrapper) => {

                    return _.get(userWrapper, 'user', {});
                }));
            });
        });
    }

    /**
     * Gets the hours for a user for the week.
     *
     * @param harvestUserId
     * @param callback
     */
    getUserHoursForLatestWeek(harvestUserId, callback) {

        this.harvest.getHoursForLatestWeek({
            qs: {
                of_user: harvestUserId
            },
            auth: this.auth,
        }, callback);
    }
}

class Harvest {

    /**
     * @param {string} clientId
     * @param {string} clientSecret
     * @param {string} apiUrl
     * @param {string} emailDomain
     */
    constructor(clientId, clientSecret, apiUrl, emailDomain) {

        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.apiUrl = apiUrl;
        this.emailDomain = emailDomain;
        this.throttle = throttledQueue(100, 20 * 1000, true); // 100 calls every 20 seconds.
    }

    /**
     * Gets the harvest admin.
     *
     * @param {string} adminEmail
     * @param {string} adminPassword
     * @param callback
     */
    getAdmin(adminEmail, adminPassword, callback) {

        const auth = {
            user: adminEmail,
            pass: adminPassword
        };

        const options = {
            url: 'account/who_am_i',
            baseUrl: this.apiUrl,
            auth: auth,
            json: true
        };

        this.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && response.statusCode != 200) {
                    err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                }


                const email = _.get(body, 'user.email', '').toLowerCase();
                const isAdmin = _.get(body, 'user.admin', false);

                if (!(_.endsWith(email, `@${this.emailDomain}`) && isAdmin)) {

                    return callback(new Error('Not authorized.'));
                }
                callback(err, new HarvestAdmin(auth, this));
            });
        });
    }

    /**
     *
     * @param {string} accessToken
     * @param {string} refreshToken
     * @param callback
     */
    getUser(accessToken, refreshToken, callback) {

        if (!accessToken) {

            return callback(new Error('Harvest auth error.'));
        }

        const options = {
            url: '/account/who_am_i',
            baseUrl: this.apiUrl,
            qs: {
                access_token: accessToken
            },
            json: true
        };

        this.throttle(() => {
            request(options, (err, response, body) => {

                const userId = _.get(body, 'user.id');

                if (!err && !userId) {
                    err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                }

                if (err) {

                    if (!refreshToken) {
                        return callback(new Error('Harvest auth error.'));
                    }

                    return this.getAccessToken('refresh_token', refreshToken, (err, tokens) => {

                        accessToken = _.get(tokens, 'access_token');
                        refreshToken = _.get(tokens, 'refresh_token');

                        if (!err && (!accessToken || !refreshToken)) {
                            err = new Error(_.get(body, 'message', _.get(body, 'error_description', 'Harvest auth error.')));
                        }

                        if (err) {
                            return callback(err);
                        }

                        this.getUser(accessToken, refreshToken, callback);
                    });
                }

                callback(err, new HarvestUser(accessToken, refreshToken, `${userId}`, this));
            });
        });
    }

    /**
     *
     * @param {string} grantType
     * @param {string} payload
     * @param callback
     * @param {string} [redirectTo]
     */
    getAccessToken(grantType, payload, callback, redirectTo) {

        let payloadKey = 'refresh_token';
        if (grantType === 'authorization_code') {
            payloadKey = 'code';
        }

        const options = {
            url: 'oauth2/token',
            baseUrl: this.apiUrl,
            method: 'POST',
            form: {
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: grantType,
                [payloadKey]: payload
            },
            json: true
        };
        if (payloadKey === 'code') {
            options.form.redirect_uri = redirectTo;
        }

        this.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && !_.get(body, 'access_token')) {
                    err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                }

                callback(err, body);
            });
        });
    }

    /**
     *
     * @param {string} redirectTo
     * @param {string} state
     * @returns {string}
     */
    getAuthorizeUrl(redirectTo, state) {

        const authorizeUrl = url.resolve(this.apiUrl, 'oauth2/authorize');
        const query = querystring.stringify({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: redirectTo,
            state: state
        });

        return `${authorizeUrl}?${query}`;
    }

    /**
     *
     * @param {{}} requestOptions
     * @param callback
     */
    getHoursForLatestWeek(requestOptions, callback) {

        let hours = 0;

        this.getTimesheetsForLatestWeek(requestOptions, (day, timesheets, callback) => {

            /**
             * Add up the hours and add it to the total.
             *
             */
            hours+= _.reduce(timesheets, (sum, timesheet) => {
                return sum + _.get(timesheet, 'hours', 0);
            }, 0);

            callback();

        }, (err) => {
            callback(err, hours);
        });
    }

    /**
     *
     * @param {{}} requestOptions
     * @param {function} forEachTimesheet
     * @param callback
     */
    getTimesheetsForLatestWeek(requestOptions, forEachTimesheet, callback) {

        const today = moment().tz(TIMEZONE);
        const monday = moment().tz(TIMEZONE);

        const todayId = today.day();

        if (todayId === 1) { // its monday
            today.subtract(1, 'day'); //
        }
        /**
         * Start from last monday.
         *
         * @type {moment.Moment}
         */
        while(monday.day() !== 1) {
            monday.subtract(1, 'day');
        }

        this.getTimesheetsForDateRange(requestOptions, forEachTimesheet, monday, today, callback);
    }

    /**
     *
     * @param {{}} requestOptions
     * @param {function} forEachTimesheet
     * @param {moment.Moment} earliest
     * @param {moment.Moment} latest
     * @param callback
     */
    getTimesheetsForDateRange(requestOptions, forEachTimesheet, earliest, latest, callback) {

        const day = latest.clone();

        async.whilst(
            /**
             * Start from friday, and move up to monday.
             *
             * @returns {boolean}
             */
            () => {
                return day.isSameOrAfter(earliest, 'date');
            },
            /**
             * Get the timesheets for a  user for a particular day.
             *
             * @param callback
             */
            (callback) => {

                const options = _.defaultsDeep({
                    url: `daily/${day.dayOfYear()}/${day.year()}`,
                    baseUrl: this.apiUrl,
                    qs: {
                        slim: 1
                    },
                    json: true
                }, requestOptions);

                this.throttle(() => {
                    request(options, (err, response, body) => {

                        if (!err && response.statusCode != 200) {
                            err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                        }

                        if (err) {
                            return callback(err);
                        }

                        const dayClone = day.clone();
                        day.subtract(1, 'day');

                        forEachTimesheet(dayClone, _.get(body, 'day_entries', []), callback);
                    });
                });
            },
            callback
        );
    }
}

/**
 * @type {Harvest}
 */
module.exports = Harvest;
