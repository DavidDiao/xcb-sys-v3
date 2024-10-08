const _ = require('lodash');
const fs = require('fs');
const http = require('http');
const log4js = require('log4js');
const querystring = require('querystring');
const { onGroupMessage, sendGroupMessage, authorized, removeListener } = require('..');
const { parse } = require('./parser');

let upstreams = [];
const logger = log4js.getLogger('upstream');

function listener(event) {
    const auths = authorized('group' + event.groupId);
    return upstreams.some(upstream => upstream.auth.some(auth => {
        if (auths.has(auth)) {
            const method = _.defaultTo(upstream.method, 'GET');
            const data = querystring.stringify({
                text: event.message,
                qq: event.userId,
                group: event.groupId,
            });
            const query = method === 'GET' ? '?' + data : '';
            const postdata = method === 'POST' ? data : undefined;
            const headers = method === 'POST' ? {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postdata.length,
            } : undefined;
            const req = http.request({
                hostname: _.defaultTo(upstream.host, 'localhost'),
                port: _.defaultTo(upstream.port, 80),
                path: upstream.path + query,
                method, headers
            }, res => {
                let ret = '';
                res.setEncoding('utf-8');
                res.on('data', chunk => ret += chunk);
                res.on('end', () => {
                    ret = parse(ret, event.userId, event.groupId);
                    if (ret) sendGroupMessage(event.groupId, ret);
                });
            });
            if (postdata) req.write(postdata);
            req.on('error', err => logger.warn(err.message));
            req.end();
            return true;
        }
    }));
}

exports.load = () => {
    return new Promise((resolve, reject) => {
        onGroupMessage(listener, 1);
        upstreams = [];
        fs.readFile('./conf/upstream.json', (err, data) => {
            if (err) return reject(err);
            data = JSON.parse(data);
            let auths = [];
            if (data.some(value => value.auth.some(auth => {
                if (_.includes(auths, auth)) return true;
                auths.push(auth);
            }))) return reject('Duplicated authentications in upstream.json.');
            upstreams = data;
            resolve();
        });
    });
};

exports.unload = () => {
    removeListener(listener);
    upstreams = [];
};
