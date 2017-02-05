"use strict";
const _ = require('lodash');

function harvestAuth(req, res) {

    const code = _.get(req, 'query.code');
    const state = _.get(req, 'query.state', '');

    console.log('code', code);
    console.log('state', state);
    
    /**
     * @type {Harvest}
     */
    const harvest = _.get(req, 'app.locals.services.harvest');

    harvest.getAccessToken('authorization_code', code, (err, tokens) => {

        if (err) {
            return res.send('Authorization failed!');
        }

        res.cookie('harvest_access_token', _.get(tokens, 'access_token'));
        res.cookie('harvest_refresh_token', _.get(tokens, 'refresh_token'));

        res.redirect(req.app.locals.appUrl(state));
    });
}

module.exports = harvestAuth;
