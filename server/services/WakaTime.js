"use strict";
const _ = require('lodash');
const async = require('async');
const moment = require('moment-timezone');
const request = require('request');
const throttledQueue = require('throttled-queue');
const querystring = require('querystring');
const url = require('url');

const TIMEZONE = 'America/New_York';

class WakaTimeUser {

    constructor(accessToken, data, wakatime) {

        this.accessToken = accessToken;
        this.data = data;
        this.wakatime = wakatime;
    }
    
    /**
     *
     * @param {function} forEachDay
     * @param callback
     */
    getDurationsByProjectForLatestWeek(forEachDay, callback) {

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

        this.getDurationsByProjectForDateRange(forEachDay, monday, today, callback);
    }

    /**
     *
     * @param {function} forEachDay
     * @param {moment.Moment} earliest
     * @param {moment.Moment} latest
     * @param callback
     */
    getDurationsByProjectForDateRange(forEachDay, earliest, latest, callback) {

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
             * Get the durations for a  user for a particular day.
             *
             * @param callback
             */
            (callback) => {

                this.getDurationsByProject(day, (err, durationsByProject) => {

                    if (err) {
                        return callback(err);
                    }

                    const dayClone = day.clone();
                    day.subtract(1, 'day');

                    forEachDay(dayClone, durationsByProject, callback);
                });
            },
            callback
        );
    }

    getDurationsByProject(day, callback) {

        this.getDurations(day, (err, durations) => {

            if (err) {
                return callback(err);
            }

            const durationsByProject = {};

            _.forEach(durations, (duration) => {

                if (!durationsByProject[duration.project]) {
                    durationsByProject[duration.project] = 0;
                }

                durationsByProject[duration.project]+= duration.duration / 3600; //hours
            });

            callback(err, durationsByProject);
        });
    }

    getDurations(day, callback) {

        const options = {
            url: 'users/current/durations',
            baseUrl: this.wakatime.versionedApiUrl,
            qs: {
                access_token: this.accessToken,
                date: day.format('YYYY-MM-DD')
            },
            json: true
        };

        this.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && (response.statusCode != 200 || !_.get(body, 'data'))) {
                    err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                }

                callback(err, _.get(body, 'data', []));
            });
        });
    }
}


class WakaTime {

    constructor(clientId, clientSecret, apiUrl, apiVersion) {

        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.apiUrl = apiUrl;
        this.versionedApiUrl = url.resolve(this.apiUrl, apiVersion);
        this.throttle = throttledQueue(1, 200);
    }

    getUser(accessToken, callback) {

        const options = {
            url: 'users/current',
            baseUrl: this.versionedApiUrl,
            qs: {
                access_token: accessToken
            },
            json: true
        };

        this.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && (response.statusCode != 200 || !_.get(body, 'data.id'))) {
                    err = new Error(_.get(body, 'message', _.get(body, 'error_description', JSON.stringify(body))));
                }

                callback(err, new WakaTimeUser(accessToken, _.get(body, 'data'), this));
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

        const authorizeUrl = url.resolve(this.apiUrl, 'oauth/authorize');
        const query = querystring.stringify({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: redirectTo,
            state: state,
            scope: 'read_logged_time'
        });

        return `${authorizeUrl}?${query}`;
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
            url: 'oauth/token',
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
}

module.exports = WakaTime;
