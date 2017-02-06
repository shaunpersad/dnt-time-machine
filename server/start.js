"use strict";

const fs = require('fs');
const _ = require('lodash');
const async = require('async');
const request = require('request');
const moment = require('moment');

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const appUrl = require('./services/appUrl');
const Harvest = require('./services/Harvest');
const Slack = require('./services/Slack');

const APP_URL = process.env.APP_URL;
const COOKIE_SECRET = process.env.COOKIE_SECRET;

const SLACK_API_URL = process.env.SLACK_API_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_GENERAL_CHANNEL = process.env.SLACK_GENERAL_CHANNEL;

const HARVEST_API_URL = process.env.HARVEST_API_URL;
const HARVEST_CLIENT_ID = process.env.HARVEST_CLIENT_ID;
const HARVEST_CLIENT_SECRET = process.env.HARVEST_CLIENT_SECRET;
const HARVEST_EMAIL_DOMAIN = process.env.HARVEST_EMAIL_DOMAIN;

const WAKATIME_API_URL = process.env.WAKATIME_API_URL;
const WAKATIME_CLIENT_ID = process.env.WAKATIME_CLIENT_ID;
const WAKATIME_CLIENT_SECRET = process.env.WAKATIME_CLIENT_SECRET;

const app = express();

app.use(express.static('./public'));
app.use(bodyParser.urlencoded({extended: false}));
app.use(cookieParser(COOKIE_SECRET));

app.locals.services = {
    harvest: new Harvest(HARVEST_CLIENT_ID, HARVEST_CLIENT_SECRET, HARVEST_API_URL, HARVEST_EMAIL_DOMAIN),
    slack: new Slack(SLACK_BOT_TOKEN, SLACK_API_URL, SLACK_GENERAL_CHANNEL),
    appUrl: appUrl(APP_URL)
};
app.get('/test', (req, res) => {

    console.log('test', Math.random());
    res.send('hello');
});
/**
 * Send a warning message.
 */
app.post('/warn', require('./api/warn'));

/**
 * Send individual messages to delinquents.
 */
app.post('/destroy', require('./api/destroy'));

/**
 * Copy timesheets from the week before to this week.
 */
app.get('/copy', require('./api/copy'));

/**
 * Harvest OAUTH callback URL.
 */
app.get('/harvest-auth', require('./api/harvestAuth'));

/**
 * Start the server.
 */
app.listen(process.env.PORT || 3000, function() {
    console.log('Listening.');
});