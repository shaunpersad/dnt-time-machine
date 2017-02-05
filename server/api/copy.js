"use strict";
const _ = require('lodash');
const async = require('async');

function copy(req, res) {

    const harvestAccessToken = _.get(req, 'cookies.harvest_access_token', '');
    const harvestRefreshToken = _.get(req, 'cookies.harvest_refresh_token', '');

    console.log('harvestAccessToken', harvestAccessToken);
    /**
     * @type {Harvest}
     */
    const harvest = _.get(req, 'app.locals.services.harvest');

    async.waterfall([
        (next) => {
            harvest.getUser(harvestAccessToken, harvestRefreshToken, next);
        },
        (harvestUser, next) => {

        console.log(harvestUser);
            res.cookie('harvest_access_token', harvestUser.accessToken || '');
            res.cookie('harvest_refresh_token', harvestUser.refreshToken || '');

            harvestUser.getHours(next);
        }
    ], (err, hours) => {

        if (err) {
            const authUrl = req.app.locals.services.appUrl('harvest-auth');
            return res.redirect(harvest.getAuthorizeUrl(authUrl, 'copy'));
        }

        res.json(hours);
        //res.redirect(harvest.apiUrl);
    });

}

module.exports = copy;
