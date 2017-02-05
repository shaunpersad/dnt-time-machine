"use strict";
const _ = require('lodash');
const async = require('async');
const moment = require('moment');
const request = require('request');
const querystring = require('querystring');
const url = require('url');

class HarvestUser {

    constructor(accessToken, refreshToken, harvest) {

        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.harvest = harvest;
    }

    getHours(callback) {

        this.harvest.getHours({
            qs: {
                access_token: this.accessToken
            }
        }, callback);
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

                async.filter(harvestUsers, (harvestUser, callback) => {

                    if (!harvestUser.is_active) {
                        return callback(null, false);
                    }

                    this.getUserHours(harvestUser.id, (err, hours) => {

                        callback(err, hours < minHours);
                    });

                }, next);
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

        request(options, (err, response, usersWrapper) => {

            if (!err && usersWrapper && _.get(usersWrapper, 'error')) {
                err = new Error(_.get(usersWrapper, 'error_description', 'Harvest API error.'));
            }

            callback(err, _.map(usersWrapper || [], (userWrapper) => {

                return _.get(userWrapper, 'user', {});
            }));
        });
    }

    /**
     * Gets the hours for a user for the week.
     *
     * @param harvestUserId
     * @param callback
     */
    getUserHours(harvestUserId, callback) {

        this.harvest.getHours({
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

        request(options, (err, response, body) => {

            if (!err && body && _.get(body, 'error')) {
                err = new Error(_.get(body, 'error_description', 'Harvest auth error.'));
            }

            const email = _.get(body, 'user.email', '').toLowerCase();
            const isAdmin = _.get(body, 'user.admin', false);

            if (!(_.endsWith(email, `@${this.emailDomain}`) && isAdmin)) {

                return callback(new Error('Not authorized.'));
            }
            callback(err, new HarvestAdmin(auth, this));
        });
    }

    getUser(accessToken, refreshToken, callback) {

        if (!accessToken || !refreshToken) {

            return callback(new Error('Not authorized.'));
        }

        const options = {
            url: '/account/who_am_i',
            baseUrl: this.apiUrl,
            qs: {
                access_token: accessToken
            },
            json: true
        };

        request(options, (err, response, body) => {

            if (!err && body && _.get(body, 'error')) {
                err = new Error(_.get(body, 'error_description', 'Harvest auth error.'));
            }

            if (err) {

                return this.getAccessToken('refresh_token', refreshToken, (err, tokens) => {

                    if (!err && body && _.get(body, 'error')) {
                        err = new Error(_.get(body, 'error_description', 'Harvest auth error.'));
                    }

                    accessToken = _.get(tokens, 'access_token');
                    refreshToken = _.get(tokens, 'refresh_token');

                    callback(err, new HarvestUser(accessToken, refreshToken, this));
                });
            }

            callback(err, new HarvestUser(accessToken, refreshToken, this));
        });
    }

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

        request(options, (err, response, body) => {

            if (!err && body && _.get(body, 'error')) {
                err = new Error(_.get(body, 'error_description', 'Harvest auth error.'));
            }

            callback(err, body);
        });
    }

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

    getHours(requestOptions, callback) {

        let hours = 0;

        this.getTimesheetsForLastWeek(requestOptions, (day, timesheets, callback) => {

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

    getTimesheetsForLastWeek(requestOptions, forEachTimesheet, callback) {

        const today = moment();
        const monday = moment();

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

                request(options, (err, response, body) => {

                    if (!err && body && _.get(body, 'error')) {
                        err = new Error(_.get(body, 'error_description', 'Harvest API error.'));
                    }

                    if (err) {
                        return callback(err);
                    }

                    const dayClone = day.clone();
                    day.subtract(1, 'day');

                    forEachTimesheet(dayClone, _.get(body, 'day_entries', []), callback);
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
