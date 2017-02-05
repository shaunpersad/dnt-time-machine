"use strict";
const _ = require('lodash');
const request = require('request');
const throttledQueue = require('throttled-queue');

class Slack {

    /**
     *
     * @param {string} botToken
     * @param {string} apiUrl
     * @param {string} generalChannel
     */
    constructor(botToken, apiUrl, generalChannel) {

        this.apiUrl = apiUrl;
        this.generalChannel = generalChannel;
        this.botToken = botToken;
        this.throttle = throttledQueue(1, 1000, true); // 1 request per second.
    }

    /**
     *
     * @param callback
     */
    getUsers(callback) {

        const options = {
            url: 'users.list',
            qs: {
                token: this.botToken
            },
            baseUrl: this.apiUrl,
            json: true
        };

        this.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && response.statusCode != 200) {
                    err = new Error(_.get(body, 'message', JSON.stringify(body)));
                }

                callback(err, _.get(body, 'members', []));
            });
        });
    }

    /**
     *
     * @param {string} message
     * @param {string} channel
     * @param callback
     */
    messageChannel(message, channel, callback) {

        const options = {
            url: 'chat.postMessage',
            qs: {
                token: this.botToken,
                channel: channel,
                as_user: true,
                text: message
            },
            baseUrl: this.apiUrl,
            json: true
        };

        this.throttle(() => {
            request(options, (err, response, body) => {

                if (!err && response.statusCode != 200) {
                    err = new Error(_.get(body, 'message', JSON.stringify(body)));
                }

                callback(err, body);
            });
        });
    }

    /**
     *
     * @param {string} email
     * @param {string} message
     * @param {[{}]} slackUsers
     * @param callback
     * @returns {*}
     */
    messageUserByEmail(email, message, slackUsers, callback) {

        const emailLowerCase = email.toLowerCase();

        const slackUser = _.find(slackUsers, (slackUser) => {

            return emailLowerCase && (emailLowerCase === _.get(slackUser, 'profile.email', '').toLowerCase());
        });

        if (!slackUser) {
            return callback(new Error('No slack user found.'));
        }

        /**
         * Protection when debugging with your @username as the general channel.
         */
        const channel = _.startsWith(this.generalChannel, '@') ? this.generalChannel : _.get(slackUser, 'id');

        this.messageChannel(message, channel, callback);
    }
}

/**
 *
 * @type {Slack}
 */
module.exports = Slack;