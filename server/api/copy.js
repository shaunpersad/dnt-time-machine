"use strict";
const _ = require('lodash');
const async = require('async');

function copy(req, res) {

    const harvestAccessToken = _.get(req, 'cookies.harvest_access_token', '');
    const harvestRefreshToken = _.get(req, 'cookies.harvest_refresh_token', '');

    /**
     * @type {Harvest}
     */
    const harvest = _.get(req, 'app.locals.services.harvest');

    async.waterfall([
        (next) => {
            harvest.getUser(harvestAccessToken, harvestRefreshToken, next);
        },
        (harvestUser, next) => {

            res.cookie('harvest_access_token', harvestUser.accessToken || '');
            res.cookie('harvest_refresh_token', harvestUser.refreshToken || '');

            harvestUser.getHours(next);
        }
    ], (err, hours) => {

        if (err) {
            const authUrl = req.app.locals.services.appUrl('harvest-auth');
            return res.redirect(harvest.getAuthorizeUrl(authUrl, 'copy'));
        }

        console.log('hours', hours);
        
        res.redirect(harvest.apiUrl);
    });

}

module.exports = copy;
