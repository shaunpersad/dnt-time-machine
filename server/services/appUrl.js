"use strict";
const querystring = require('querystring');
const url = require('url');

module.exports = function appUrl(baseUrl) {

    return function(path, query) {
        if (!path) {
            path = '/';
        }
        if (!query) {
            return url.resolve(baseUrl, path);
        }
        return `${url.resolve(baseUrl, path)}?${querystring.stringify(query)}`;
    };
};
