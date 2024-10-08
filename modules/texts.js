const _ = require('lodash');
const fs = require('fs');
const log4js = require('log4js');
const QuickLRU = require('quick-lru');
const { authorized, getActualPermission, sendGroupMessage, onPrivateMessage, onGroupMessage, removeListener } = require('../index');
const { isBlocked } = require('./admin');
const { parse } = require('./parser');

let loaded = false;
let texts = {};
let groups = {};
let replaces = [];
let cache = new QuickLRU({ maxSize: 1024 });
let lastUpdates = {};
const logger = log4js.getLogger('texts');

function matchResponse(event, auth, protect) {
    let index = Infinity, response = [], message = event.message;
    replaces.forEach(value => {
        message = message.replace(value.pattern, value.replace);
    });
    /*
    if (cache.has(message)) {
        response = cache.get(message);
    } else {
    */
    auth.forEach(auth => (groups[auth] || []).forEach(category => texts[category].forEach(reply => {
        let match = reply.pattern.exec(message);
        if (match && match.index <= index) {
            if (match.index != index) response = [];
            index = match.index;
            response.push(reply.response);
        }
    })));
    if (!response.length) return false;
    /*
        cache.set(message, response);
    }
    */
    return parse(response[_.random(0, response.length - 1)], event.userId, event.groupId, protect);
}

function privateMessageHandler(event) {
    if (isBlocked(event.userId)) return false;
    const res = matchResponse(event, authorized('user' + event.userId), true);
    if (res === false) return false;
    return res ? res : true;
}

function groupMessageHandler(event) {
    if (isBlocked(event.userId, event.groupId)) return false;
    const res = matchResponse(event, authorized('group' + event.groupId), ['member', 'admin', 'owner'].indexOf(event.sender.role) >= getActualPermission(event.selfId, event.groupId));
    if (res === false) return false;
    return res ? res : true;
}

function loadFile(fn) {
    return new Promise(resolve => {
        lastUpdates[fn] = fs.statSync(`./conf/texts/${fn}.txt`).mtime;
        fs.readFile(`./conf/texts/${fn}.txt`, 'utf-8', (err, data) => {
            texts[fn] = [];
            if (err) return resolve();
            data.split('\n').forEach(line => {
                line = line.trim();
                let match = line.match(/\t+/);
                if (!match || match.index == 0) return;
                texts[fn].push({
                    pattern: new RegExp(line.substr(0, match.index), 'i'),
                    response: line.substr(match.index + match[0].length)
                });
            });
            resolve();
        });
    });
}

function loadAll() {
    return new Promise((resolve, reject) => {
        lastUpdates = {'/conf': fs.statSync('./conf/texts.json').mtime};
        fs.readFile('./conf/texts.json', 'utf-8', (err, data) => {
            if (err) return reject(err);
            data = JSON.parse(data);
            groups = data.auth;
            replaces = data.replace.map(value => {
                try {
                    return {
                        pattern: new RegExp(value.pattern, value.flags || 'g'),
                        replace: value.replace
                    };
                } catch (e) {
                    return false;
                }
            }).filter(v => v);
            let files = new Set();
            for (let name in groups) {
                groups[name].forEach(fn => files.add(fn));
            }
            texts = {};
            Promise.all(Array.from(files).map(loadFile)).then(() => {
                setTimeout(checkUpdate, 1000);
                resolve();
            });
        });
    });
}

function checkUpdate() {
    if (!loaded) return;
    if (fs.statSync('./conf/texts.json').mtime > lastUpdates['/conf']) {
        loadAll().then(() => {
            cache.clear();
            logger.info('Texts reloaded.');
            sendGroupMessage(732037074, '文本已更新');
            setTimeout(checkUpdate, 1000);
        });
        return;
    }
    let tmp = [];
    for (let fn in lastUpdates) {
        if (fn[0] === '/') continue;
        if (fs.statSync(`./conf/texts/${fn}.txt`).mtime > lastUpdates[fn]) {
            tmp.push(loadFile(fn).then(() => {
                cache.clear();
                logger.info(`Text ${fn} reloaded.`);
                sendGroupMessage(732037074, `文本${fn}已更新`);
                setTimeout(checkUpdate, 1000);
            }));
        }
    }
    Promise.all(tmp).then(() => setTimeout(checkUpdate, 1000));
}

exports.load = () => {
    loaded = true;
    onPrivateMessage(privateMessageHandler, 500);
    onGroupMessage(groupMessageHandler, 500);
    cache.clear();
    return loadAll().then(() => logger.info('Module loaded.'));
};

exports.unload = () => {
    loaded = false;
    removeListener(privateMessageHandler);
    removeListener(groupMessageHandler);
    texts = {};
    groups = {};
    lastUpdates = {};
    replaces = [];
    cache.clear();
    logger.info('Module unloaded.');
};
