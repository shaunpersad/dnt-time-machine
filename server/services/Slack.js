"use strict";
const _ = require('lodash');
const request = require('request');

class Slack {

    constructor(botToken, apiUrl, generalChannel) {

        this.apiUrl = apiUrl;
        this.generalChannel = generalChannel;
        this.botToken = botToken;
    }

    getUsers(callback) {

        const options = {
            url: 'users.list',
            qs: {
                token: this.botToken
            },
            baseUrl: this.apiUrl,
            json: true
        };

        request(options, (err, response, body) => {

            callback(err, _.get(body, 'members', []));
        });
    }

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

        request(options, (err, response, body) => {

            callback(err, body);
        });
    }

    messageUserByEmail(email, message, slackUsers, callback) {

        const emailLowerCase = email.toLowerCase();

        const slackUser = _.find(slackUsers, (slackUser) => {

            return emailLowerCase && (emailLowerCase === _.get(slackUser, 'profile.email', '').toLowerCase());
        });

        if (!slackUser) {
            return callback(new Error('No slack user found.'));
        }

        const channel = _.startsWith(this.generalChannel, '@') ? this.generalChannel : _.get(slackUser, 'id');

        console.log(email);
        callback();
        //this.messageChannel(message, channel, callback);
    }
}

/**
 *
 * @type {Slack}
 */
module.exports = Slack;