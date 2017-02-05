"use strict";
const url = require('url');

module.exports = function appUrl(baseUrl) {

    return function(path) {
        if (!path) {
            path = '/';
        }
        return url.resolve(baseUrl, path);
    };
};
