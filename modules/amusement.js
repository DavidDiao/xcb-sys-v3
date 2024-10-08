const _ = require('lodash');
const fs = require('fs');
// const log4js = require('log4js');
const { onPrivateMessage, onGroupMessage, removeListener, authorized, getPermission } = require('..');
const { block, isBlocked } = require('./admin');
const { parse } = require('./parser');

let categories = {};
// const logger = log4js.getLogger('amusement');
const lastGoodnight = {}, lastZaima = {};

function has(event, auth) {
    if (!event.sender.group) return true;
    const authed = authorized(event.sender.group ? 'group' + event.sender.group.id : 'user' + event.sender.id);
    return authed?.length;
    // return _.some(categories[auth], auth => authed.has(auth));
}

function listener(event) {
    if (isBlocked(event.userId, event.groupId)) return false;
    if (!has(event)) return false;

    // if (event.message == '签到') {
    //     if (!has(event, 'checkin')) return false;
    //     // TODO
    //     return true;
    // }

    let message = event.messageChain.map(msg => msg.type === 'Plain' ? msg.text
                                              : msg.type === 'Image' ? msg.imageId
                                              : null).join('\n').trim();
    
    if (message.match(/^老婆[!！]*$/m)) {
        // let response = _.has(categories.wife, event.userId) ? categories.wife[event.userId] : [
        let response = [
            '[img=%PICTURE_PATH%guna!.jpg]',
            '[img=%PICTURE_PATH%guna!!.jpg]',
            '[img=%PICTURE_PATH%不理你啦.jpg][ban=1]',
            '[img=%PICTURE_PATH%再也不理你啦.jpg][ban=2]',
        ];
        if (typeof response !== 'string') response = response[_.random(0, response.length - 1)];
        return parse(response, event.sender.id, event.sender.group?.id);
    }

    if (message.match(/^晚安[!！]*$/m)) {
        let crntTime = new Date().getTime();
        if (new Date(crntTime + 4 * 60 * 60 * 1000).getHours() < 10) {
            if (crntTime - _.get(lastGoodnight, event.sender.id, 0) >= 12 * 60 * 60 * 1000) {
                lastGoodnight[event.sender.id] = crntTime;
                return parse('[img=%PICTURE_PATH%晚安.jpg]');
            }
            return parse('[img=%PICTURE_PATH%滚去睡觉.jpg][ban=7:0]', event.sender.id, event.sender.group?.id);
        }
        return parse('[img=%PICTURE_PATH%睡你妈逼起来嗨.jpg]');
    }
    
    if (message.match(/^(zaima|在吗)$/m)) {
        let crntTime = new Date().getTime();
        // if (crntTime - _.get(lastZaima, event.userId, 0) >= 3 * 60 * 1000 || getPermission(event.userId, event.groupId) > 0) {
        if (crntTime - _.get(lastZaima, event.sender.id, 0) >= 3 * 60 * 1000) {
            lastZaima[event.sender.id] = crntTime;
            return parse('[img=%PICTURE_PATH%zaide.jpg]');
        }
        return parse('[img=%PICTURE_PATH%buzai.jpg][ban=5]', event.sender.id, event.sender.group?.id);
    }

    if (message.match(/^铁锅炖(糍粑|自己)$/)) {
        // if (getPermission(event.userId, event.groupId) < 1) block(event.userId, event.groupId, 5 * 60);
        return parse('[img=%PICTURE_PATH%铁锅炖糍粑.jpg][ban=5]', event.sender.id, event.sender.group?.id);
    }

    if (message.match(/^(小?糍粑 *)?出来挨打$/)) {
        // if (getPermission(event.userId, event.groupId) < 1) block(event.userId, event.groupId, 5 * 60);
        return parse('[img=%PICTURE_PATH%挨打.jpg][ban=5]', event.sender.id, event.sender.group?.id);
    }

    if (message.match(/FA7054F1E81938EEABA9D139BA1C14A3/)) { // Air Conditioner
        return false;
    }

    return false;
}

module.exports = {
    load: () => {
        onPrivateMessage(listener, 150);
        onGroupMessage(listener, 150);
        return new Promise((resolve, reject) => {
            categories = {};
            fs.readFile('conf/amusement.json', (err, data) => {
                if (err) return reject(err);
                categories = JSON.parse(data);
                resolve();
            });
        });
    },
    unload: () => {
        removeListener(listener);
    },
};
