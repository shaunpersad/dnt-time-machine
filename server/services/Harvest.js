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
                slim: 1,
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


            if (err) {
                console.log('did not get user', err.message);

                return this.getAccessToken('refresh_token', refreshToken, (err, tokens) => {

                    console.log('refresh token', tokens, err);

                    accessToken = _.get(tokens, 'access_token');
                    refreshToken = _.get(tokens, 'refresh_token');

                    callback(err, new HarvestUser(accessToken, refreshToken, this));
                });
            }

            console.log('got user');

            callback(err, new HarvestUser(accessToken, refreshToken, this));
        });
    }

    getAccessToken(grantType, payload, callback) {

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

        console.log(options);

        request(options, (err, response, body) => {

            if (body || _.get(body, 'error')) {
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

                const options = _.defaultsDeep(requestOptions, {
                    url: `daily/${today.dayOfYear()}/${today.year()}`,
                    baseUrl: this.apiUrl,
                    json: true
                });

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
}

/**
 * @type {Harvest}
 */
module.exports = Harvest;
