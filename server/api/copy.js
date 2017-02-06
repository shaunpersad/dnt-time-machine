"use strict";
const _ = require('lodash');
const async = require('async');
const url = require('url');

const dangerousCache = {}; // wehh. necessary evil to combat chrome's multiple requests. the number of harvest users will never be more than a few hundred anyway.

function copy(req, res) {

    const harvestAccessToken = _.get(req, 'query.harvest_access_token', _.get(req, 'cookies.harvest_access_token', ''));
    const harvestRefreshToken = _.get(req, 'cookies.harvest_refresh_token', '');

    /**
     * @type {Harvest}
     */
    const harvest = _.get(req, 'app.locals.services.harvest');

    harvest.getUser(harvestAccessToken, harvestRefreshToken, (err, harvestUser) => {

        if (err) {
            const authUrl = req.app.locals.services.appUrl('harvest-auth');
            return res.redirect(harvest.getAuthorizeUrl(authUrl, 'copy'));
        }


        res.cookie('harvest_access_token', harvestUser.accessToken || '');
        res.cookie('harvest_refresh_token', harvestUser.refreshToken || '');

        if (!dangerousCache[harvestUser.id]) {
            dangerousCache[harvestUser.id] = [];
        }

        const length = dangerousCache[harvestUser.id].length;
        dangerousCache[harvestUser.id].push(res);

        if (!length) {
            harvestUser.copyPreviousWeekIntoLatest((err, numCreated) => {

                let res;
                while (res = dangerousCache[harvestUser.id].pop()) {
                    res.redirect(url.resolve(harvest.apiUrl, '/time/week'));
                }
                delete dangerousCache[harvestUser.id];
            });
        }
    });
}

module.exports = copy;
