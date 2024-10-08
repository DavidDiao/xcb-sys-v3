const _ = require('lodash');
const fs = require('fs');
const http = require('http');
const log4js = require('log4js');
const mysql = require('mysql');
const process = require('process');

const camelCaseKey = obj => _.mapKeys(obj, _.flow([_.nthArg(1), _.camelCase]));
const snakeCaseKey = obj => _.mapKeys(obj, _.flow([_.nthArg(1), _.snakeCase]));
const insertByPriority = (arr, obj) => arr.splice(_.sortedLastIndexBy(arr, obj, 'priority'), 0, obj);

require('dotenv').config('.env');

log4js.configure({
    appenders: {
        console: {
            type: 'console'
        },
        file: {
            type: 'file',
            filename: process.env['LOG_FILE']
        }
    },
    categories: {
        default: {
            appenders: process.env.LOG_TYPE == 'BOTH' ? ['console', 'file'] : [process.env.LOG_TYPE.toLowerCase()],
            level: process.env.LOG_LEVEL
        }
    }
});

const logger = log4js.getLogger('server');
let inited = false;

process.on('uncaughtException', e => {
    logger.error('Uncaught exception: ' + e.stack);
    sendGroupMessage(732037074, 'Uncaught exception: ' + e.stack);
    if (!inited) {
        logger.error('Failed while initializing. Shutting down.');
        shutdown(0);
    } else if (loaded === undefined) {
        logger.error('Failed while shutting down.');
        return;
    } else shutdown(1);
});

process.on('unhandledRejection', e => {
    logger.warn('Uncaught rejection: ' + e.stack);
    sendGroupMessage(732037074, 'Uncaught rejection: ' + e.stack);
    if (!inited) {
        logger.error('Failed while initializing. Shutting down.');
        shutdown(0);
    }
});

process.on('SIGINT', () => {
    logger.info('Manually terminating.');
    shutdown(0);
});

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

const initProm = [];

const modules = {};
let loaded = [];

function shutdown(exitCode = 0) {
    const _loaded = loaded;
    if (_loaded === undefined) {
        return;
    }
    let prom = [];
    loaded = undefined;
    _loaded.forEach(mod => {
        if (mod.unload) {
            try {
                let rtn = mod.unload();
                if (rtn instanceof Promise) prom.push(rtn);
            } catch (e) {
                logger.error('Error while shutting down: ' + e.stack);
            }
        }
    });
    Promise.all(prom).then(() => {
        logger.info('Server shutdown.');
        process.exit(exitCode);
    });
}

const tags = {};

/**
 * Register a tag handler, replaces old if registered again.
 * @param {string} name Tag name
 * @param {function(string, number, number, boolean): {
 *   text: string,
 *   replaceAll: boolean?
 * }|string} callback Callback, parameters are text, userId, groupId, protect, returns parsed text
 * or {text: parsed text, replaceAll: true} if wish to directly return the text
 */
function registerTag(name, callback) {
    tags[name] = callback;
}

/**
 * Convert a common text to CQ code
 * @param {string} text Raw text
 * @param {number} userId QQ number
 * @param {number} [groupId=0] Group ID
 * @param {boolean} [protect=false] Use ban-failure message if available. Automatically set to true if groupId is false value
 * @returns {string} Parsed text
 */
function parse(text, userId, groupId, protect = false) {
    let alt;
    text = text
        .replace(/%([\w_]+)%/g, (...match) => _.defaultTo(process.env[match[1]], ''))
        .replace(/\[(\w+)(?:=(.*?))?(?<!\\)\]/g, (match, tag, arg) => {
            if (alt !== undefined) return '';
            if (!_.has(tags, tag)) return match;
            let ret = tags[tag](arg, userId, groupId, protect);
            if (typeof ret === 'object') {
                if (ret.replaceAll) alt = ret.text;
                else ret = ret.text;
            }
            return ret;
        });
    return alt ? alt : text;
}

const events = {
    privateMessage: [],
    groupMessage: [],
    discussMessage: [],
    adminChanges: [],
    memberChanges: [],
    newFriend: [],
    friendRequest: [],
    joinGroupRequest: [],
    inviteGroupRequest: [],
    lifecycle: [],
    heartbeat: [],
};

/**
 * Simplified user info when receiving message.
 * Some properties are only available in group message events.
 * @typedef {Object} Sender
 * @property {number} userId QQ number
 * @property {string} nickname User nickname
 * @property {string} [card] Group card/remark
 * @property {'male'|'female'|'unknown'} sex
 * @property {number} age User age
 * @property {string} [area]
 * @property {string} [level] Group active level
 * @property {'owner'|'admin'|'member'} [role]
 * @property {string} [title] Exclusive title of the member
 */

/**
 * Info of anonymous user in group chat
 * @typedef {Object} AnonymousInfo
 * @property {number} id
 * @property {string} name
 * @property {string} flag Argument to send if you wish to ban him
 */

/**
 * Message event.
 * @typedef {Object} MessageEvent
 * @property {'message'} postType
 * @property {'private'|'group'|'discuss'} messageType
 * @property {'friend'|'group'|'discuss'|'other'|'normal'|'anonymous'|'notice'} [subType]
 * When messageType == `'private'`, `'friend'` if from a friend, `'group'` or `'discuss'` if from a temporary chat;
 * when messageType == `'group'`, `'normal'` if is normal message, `'anonymous'` if is anonymous message, `'notice'` if is system notice;
 * When messageType == `'discuss'`, this property is undefined
 * @property {number} messageId Message ID
 * @property {number} [groupId] Group ID, only available if messageType == `'group'`
 * @property {number} [discussId] Discuss ID, only available if messageType == `'discuss'`
 * @property {AnonymousInfo} [anonymous] Anonymous user info, only possible to available if messageType == `'group'`
 * @property {number} userId QQ number
 * @property {string} message Message
 * @property {string} rawMessage Raw message
 * @property {number} font Font
 * @property {Sender} sender Sender info
 */

/**
 * Add a private message listener.
 * @param {function(MessageEvent): (boolean|string)} listener return `false` if ignored, return `true` if accepted, string if accepted and response with a message
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onPrivateMessage(listener, priority = 200) {
    insertByPriority(events.privateMessage, { listener, priority });
}

/**
 * Add a group message listener.
 * @param {function(MessageEvent): (boolean|string)} listener return `false` if ignored, return `true` if accepted, string if accepted and response with a message
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onGroupMessage(listener, priority = 200) {
    insertByPriority(events.groupMessage, { listener, priority });
}

/**
 * Add a discuss group message listener.
 * @param {function(MessageEvent): (boolean|string)} listener Return `false` if ignored, return `true` if accepted, string if accepted and response with a message
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onDiscussMessage(listener, priority = 200) {
    insertByPriority(events.discussMessage, { listener, priority });
}

/**
 * Add an admin changes listener
 * @param {function({
 *   postType: 'notice',
 *   noticeType: 'group_admin',
 *   subType: ('set'|'unset'),
 *   groupId: number,
 *   userId: number,
 * }): void} listener Listener
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onAdminChange(listener, priority = 200) {
    insertByPriority(events.adminChanges, { listener, priority });
}

/**
 * Add a member changes listener
 * @param {function({
 *   postType: 'notice',
 *   noticeType: ('group_decrease'|'group_increase'),
 *   subType: ('leave'|'kick'|'kick_me'|'approve'|'invite'),
 *   groupId: number,
 *   operatorId: number,
 *   userId: number,
 * }): void} listener Listener
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onMemberChange(listener, priority = 200) {
    insertByPriority(events.memberChanges, { listener, priority });
}

/**
 * Add a new firend listener
 * @param {function({
 *   postType: 'notice',
 *   noticeType: 'friend_add',
 *   userId: number,
 * }): void} listener Listener
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onNewFriend(listener, priority = 200) {
    insertByPriority(events.newFriend, { listener, priority });
}

/**
 * Add an friend request listener
 * @param {function({
 *   postType: 'request',
 *   requestType: 'friend',
 *   userId: number,
 *   comment: string,
 *   flag: string,
 * }): (boolean|string|void)} listener Return nothing if ignored, otherwise block the event and return `false` if rejected, return `true` if approved, string if accepted and given a remark
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onFriendRequest(listener, priority = 200) {
    insertByPriority(events.friendRequest, { listener, priority });
}

/**
 * Add a group-join request listener
 * @param {function({
 *   postType: 'request',
 *   requestType: 'group',
 *   subType: 'add',
 *   groupId: number,
 *   userId: number,
 *   comment: string,
 *   flag: string,
 * }): (boolean|string|void)} listener Return nothing if ignored, otherwise block the event and return `false` if rejected, return `true` if approved, string if rejected with a reason
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onJoinGroupRequest(listener, priority = 200) {
    insertByPriority(events.joinGroupRequest, { listener, priority });
}

/**
 * Add a group-invite request listener
 * @param {function({
 *   postType: 'request',
 *   requestType: 'group',
 *   subType: 'invite',
 *   groupId: number,
 *   userId: number,
 *   comment: string,
 *   flag: string,
 * }): (boolean|string|void)} listener Return nothing if ignored, otherwise block the event and return `false` if rejected, return `true` if approved, string if rejected with a reason
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onInviteGroupRequest(listener, priority = 200) {
    insertByPriority(events.inviteGroupRequest, { listener, priority });
}

/**
 * Add a remote plugin lifecycle event listener
 * @param {function(('enable'|'disable')): void} listener Listener
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onRemoteLifecycle(listener, priority = 200) {
    insertByPriority(events.lifecycle, { listener, priority});
}

/**
 * CoolQ HTTP API plugin status
 * @typedef {Object} RemoteStatus
 * @property {boolean} appInitialized
 * @property {boolean} appEnabled
 * @property {Object} pluginsGood
 * @property {boolean} appGood
 * @property {boolean} online
 * @property {boolean} good
 */

/**
 * Add a heartbeat listener
 * @param {function(RemoteStatus): void} listener Listener
 * @param {number} [priority=200] Priority of listener, default is `200`
 */
function onHeartbeat(listener, priority = 200) {
    insertByPriority(events.heartbeat, { listener, priority});
}

/**
 * Remove all events the listener registered
 * @param {Function} listener Listener to be removed
 */
function removeListener(listener) {
    _.forEach(type => _.remove(type, ['listener', listener]));
}

function emit(parameters, listeners, terminate = () => false, format) {
    for (let listener of listeners) {
        let ret = listener.listener(parameters);
        if (!terminate(ret)) continue;
        return format(ret);
    }
}

/**
 * Send a request to coolq-http-api.
 * @param {string} name Request path
 * @param {Object} [parameters={}] Post data
 * @param {function(*): void} [callback] Response
 */
function sendRequest(name, parameters, callback) {
    if (typeof parameters === 'function') {
        callback = parameters;
        parameters = {};
    } else if (!parameters) parameters = {};
    const content = JSON.stringify(snakeCaseKey(parameters));
    logger.trace(name + '?' + content);
    const req = http.request({
        host: process.env.COOLQ_HOST,
        port : process.env.COOLQ_PORT,
        method : 'POST',
        path: name,
        headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(content) }
    }, res => {
        if (!callback) return;
        res.setEncoding('utf8');
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            let ret = JSON.parse(data);
            if (data.length > 200) logger.trace('Message too long, skipped.');
            else logger.trace(ret);
            callback(ret.data);
        });
    });
    req.write(content);
    req.end();
}

/**
 * Send a private message
 * @param {number} userId QQ number
 * @param {string} message Message
 * @param {Object} [parameters] options
 * @param {boolean} [parameters.escape=false] Send as plaintext
 * @param {function(number): void} [callback] Message ID
 */
function sendPrivateMessage(userId, message, parameters, callback) {
    if (typeof parameters === 'function') {
        callback = parameters;
        parameters = {};
    }
    if (!parameters) parameters = {};
    sendRequest('/send_private_msg', {
        userId, message,
        autoEscape: parameters.escape
    }, callback ? res => callback(res.message_id) : undefined);
}

/**
 * Send a group message
 * @param {number} groupId Group ID
 * @param {string} message Message
 * @param {Object} [parameters] options
 * @param {boolean} [parameters.escape=false] Send as plaintext
 * @param {function(number): void} [callback] Message ID
 */
function sendGroupMessage(groupId, message, parameters, callback) {
    if (typeof parameters === 'function') {
        callback = parameters;
        parameters = {};
    }
    if (!parameters) parameters = {};
    sendRequest('/send_group_msg', {
        groupId, message,
        autoEscape: parameters.escape
    }, callback ? res => callback(res.message_id) : undefined);
}

/**
 * Send a discussion group message
 * @param {number} groupId Group ID
 * @param {string} message Message
 * @param {Object} [parameters] options
 * @param {boolean} [parameters.escape=false] Send as plaintext
 * @param {function(number): void} [callback] Message ID
 */
function sendDiscussMessage(groupId, message, parameters, callback) {
    if (typeof parameters === 'function') {
        callback = parameters;
        parameters = {};
    }
    if (!parameters) parameters = {};
    sendRequest('/send_discuss_msg', {
        discussId: groupId,
        message,
        autoEscape: parameters.escape
    }, callback ? res => callback(res.message_id) : undefined);
}

/**
 * Revoke a message
 * @param {number} messageId Message ID
 */
function revokeMessage(messageId) {
    sendRequest('/delete_msg', { messageId });
}

/**
 * Kick a user from a group
 * @param {number} userId QQ number
 * @param {number} groupId Group ID
 * @param {boolean} [rejectForever=false] Reject the user's join request
 */
function kickUser(userId, groupId, rejectForever) {
    sendRequest('/set_group_kick', {
        userId, groupId,
        rejectAddRequest: rejectForever,
    });
}

/**
 * Ban a user in a specific group
 * @param {number} userId QQ number
 * @param {number} groupId Group ID
 * @param {number} [time=1800] Seconds to ban
 */
function banUser(userId, groupId, time) {
    sendRequest('/set_group_ban', {
        userId, groupId,
        duration: time,
    });
}

/**
 * Ban an anonymous user in a specific group
 * @param {string} flag Anonymous flag received from the event
 * @param {number} groupId Group ID
 * @param {number} [time=1800] Seconds to ban
 */
function banAnonymousUser(flag, groupId, time) {
    sendRequest('/set_group_anonymous_ban', {
        flag, groupId,
        duration: time,
    });
}

/**
 * Leave or disban a group
 * @param {number} groupId Group ID
 * @param {boolean} [dismiss=false] The group would be dismissed if set to true and bot is the owner of the group
 */
function leaveGroup(groupId, dismiss) {
    sendRequest('/set_group_leave', {
        groupId,
        isDismiss: dismiss,
    });
}

/**
 * Leave a dismiss group
 * @param {number} groupId Group ID
 */
function leaveDiscuss(groupId) {
    sendRequest('/set_discuss_leave', { discussId: groupId });
}

/**
 * Process an add-friend request
 * @param {string} flag Request flag received from the event
 * @param {boolean} [approve=true] Approve or not
 * @param {string} [alias] Alias to set if approved
 */
function processFriendRequest(flag, approve, alias) {
    sendRequest('/set_friend_add_request', {
        flag, approve,
        remark: alias,
    });
}

/**
 * Process an add-group request
 * @param {string} flag Request flag received from the event
 * @param {boolean|string} [approveOrRejectReason=true] Approve or not, pass a string to reject and give the reason
 */
function processAddGroupRequest(flag, approveOrRejectReason) {
    sendRequest('/set_group_add_request ', {
        flag,
        approve: approveOrRejectReason === undefined || approveOrRejectReason === true,
        subType: 'add',
        reason: typeof approveOrRejectReason === 'string' ? approveOrRejectReason : undefined,
    });
}

/**
 * Process an add-group invitation
 * @param {string} flag Request flag received from the event
 * @param {boolean|string} [approveOrRejectReason=true] Approve or not, pass a string to reject and give the reason
 */
function processGroupInvitation(flag, approveOrRejectReason) {
    sendRequest('/set_group_add_request ', {
        flag,
        approve: approveOrRejectReason === undefined || approveOrRejectReason === true,
        subType: 'invite',
        reason: typeof approveOrRejectReason === 'string' ? approveOrRejectReason : undefined,
    });
}

/**
 * Get group list
 * @param {function({groupId: number, groupName: string}[]): void} callback Response with an array with object of group ID and name
 */
function getGroupList(callback) {
    sendRequest('/get_group_list', res => callback(_.map(res, camelCaseKey)));
}

/**
 * @typedef {Object} MemberInfo
 * @property {number} groupId
 * @property {number} userId
 * @property {string} nickname
 * @property {string} card Group card/remark
 * @property {'male'|'female'|'unknown'} sex
 * @property {number} age
 * @property {string} area
 * @property {number} joinTime Timestamp of join the group
 * @property {number} lastSendTime Timestamp of last time to send a message
 * @property {string} level Group active level
 * @property {'owner'|'admin'|'member'} role
 * @property {boolean} unfriendly Whether the member has a bad record
 * @property {string} title Exclusive title of the member
 * @property {number} titleExpireTime Timestamp of the expiration of the title
 * @property {boolean} cardChangeable Whether you are allowed to change the card
 */

/**
 * Get member list of the specified group
 * @param {number} groupId Group ID
 * @param {function(MemberInfo[]): void} callback Response with an array of member info
 */
function getGroupMembers(groupId, callback) {
    sendRequest('/get_group_member_list', { groupId }, res => callback(_.map(res, camelCaseKey)));
}

let auth = {};

function updateAuthorizationCache() {
    return new Promise((resolve, reject) => {
        let _auth = {};
        pool.query('select * from auth', [], (error, result) => {
            if (error) return reject(error);
            result.forEach(row => {
                _.setWith(_auth, [(row.isgroup ? 'group' : 'user') + row.target, row.type], row.expire, Object);
            });
            auth = _auth;
            resolve();
        });
    });
}

initProm.push(updateAuthorizationCache());

/**
 * Query whether the target was authorized or all authorizations the target owns.
 * @param {string} target ID of the target. `user` or `group` followed by the QQ number or group number, for example `'group732037074'`.
 * @param {string} [name] Name of the authorization. If not specified, this function will return an array of all authorizations.
 * @returns {boolean|Set.<string>} The target owns the authorization or all of the authorizations the target owns.
 */
function authorized(target, name) {
    if (typeof target != 'string') target = target.toString();
    if (!target.match(/^(group|user)\d+/)) throw new Error('Illegal argument: target must starts with "group" or "user", but was: ' + target);
    if (name) {
        if (target[0] == 'g') return _.get(auth, [target, name], 0) >= new Date();
        return getGroupsBelongsTo(target.substr(4)).some(value => authorized('group' + value));
    }
    let rtn = new Set();
    _.forEach(auth[target], (value, key) => {
        if (value >= new Date()) rtn.add(key);
    });
    if (target[0] == 'u') getGroupsBelongsTo(target.substr(4)).forEach(group => authorized('group' + group).forEach(value => rtn.add(value)));
    return rtn;
}

/**
 * Get when the authorizations will expire or expired. This function won't check the group which the member belongs to.
 * @param {string} target ID of the target. `user` or `group` followed by the QQ number or group number, for example `'group732037074'`.
 * @param {string} [name] Name of the authorization. If not specified, all authorizations will be returned.
 * @returns {undefined|Date|Object.<string,Date>} The expiration date of the authorization(s).
 */
function getAuthorizationExpires(target, name) {
    if (typeof target != 'string') target = target.toString();
    if (!target.match(/(group|user)\d+/)) throw new Error('Illegal argument: target must starts with "group" or "user", but was: ' + target);
    if (name) return _.get(auth, [target, name]);
    return _.clone(auth[target]);
}

/**
 * 
 * @param {string} target ID of the target. `user` or `group` followed by the QQ number or group number, for example `'group732037074'`.
 * @param {string} name Name of the authorization
 * @param {'prolong'|'set'|'cancel'} [type='prolong'] How to update the authorization
 * @param {number} [duration=1] Time to prolong, pass a timestamp in seconds if type is `'set'`
 * @param {'second'|'minute'|'hour'|'day'|'week'|'month'|'quarter'|'year'} [unit='month'] Unit of duration, valid only when type is `'prolong'`
 * @param {function(boolean): void} [callback] Whether operation was successful or not
 */
function updateAuthorization(target, name, type = 'prolong', duration = 1, unit = 'month', callback) {
    if (typeof type !== 'string') {
        callback = unit;
        unit = duration;
        duration = type;
        type = 'prolong';
    }
    if (typeof duration !== 'number') {
        callback = duration;
        duration = 1;
    }
    if (typeof unit !== 'string') {
        callback = unit;
        unit = 'month';
    }
    const rawtarget = target;
    if (target.startsWith('group')) target = { target: target.substr(5), isgroup: true };
    else if (target.startsWith('user')) target = { target: target.substr(4), isgroup: false };
    else throw new Error('Illegal argument: target must starts with "group" or "user", but was: ' + target);
    if (['prolong', 'set', 'cancel'].indexOf(type) === -1) throw new Error('Illegal argument: type shoud be one of "prolong", "set", or "cancel", but was: ' + type);
    let sql;
    const alreadyExists = _.has(auth, [rawtarget, name]), isauthorized = authorized(rawtarget, name);
    if (type == 'prolong') {
        if (['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'].indexOf(unit) === -1)
            throw new Error('Illegal argument: unit must be one of "second", "minute", "hour", "day", "week", "month", "quarter" or "year", but was: ' + unit);
        sql = {
            sql: alreadyExists
                ? 'update auth set expire = timestampadd(?, ?, ?) where target = ? and isgroup = ? and type = ?'
                : 'insert into auth (expire, target, isgroup, type) values (timestampadd(?, ?, ?), ?, ?, ?)',
            values: [mysql.raw(unit), duration, isauthorized ? mysql.raw('expire') : mysql.raw('now()'), target.target, target.isgroup, name]
        };
    } else if (type == 'set') sql = {
        sql: alreadyExists
            ? 'update auth set expire = ? where target = ? and isgroup = ? and type = ?'
            : 'insert into auth (expire, target, isgroup, type) values (?, ?, ?, ?)',
        values: [new Date(duration * 1000), target.target, target.isgroup, name]
    }; else sql = {
        sql: 'delete from auth where target = ? and isgroup = ? and name = ?',
        values: [target.target, target.isgroup, name]
    };
    pool.query(sql, async err => {
        await updateAuthorizationCache();
        if (err) {
            callback(false);
            logger.warn(err.sqlMessage);
        } else callback(true);
    });
}

let permissions = {};

function updatePermissionCache(clear = true) {
    return new Promise((resolve, reject) => {
        pool.query('select * from admin', (err, result) => {
            if (err) return reject(err);
            if (clear) permissions = {};
            result.forEach(row => {
                _.setWith(permissions, [row.qq, row.qqgroup], row.permission, Object);
            });
            resolve();
        });
    });
}

/**
 * Get permission of specified user (in specified group)
 * @param {number} userId QQ number
 * @param {number} [groupId=0] Group ID, leave empty or `0` to get the user's global permission
 * @returns {number} Permission level, `0` is no permission, `1` is admin, `2` is group owner, `3` is global admin, `4` is xcb owner
 */
function getPermission(userId, groupId) {
    let rslt = _.get(permissions, [userId, _.defaultTo(groupId, 0)], 0);
    if (groupId) rslt = _.max([rslt, getPermission(userId)]);
    return rslt;
}

/**
 * Set permission of specified user in specified group or globally
 * @param {number} userId QQ number
 * @param {number} groupId Group ID, `0` to set globally. If permission > 2, this option is automatically set to `0`
 * @param {number} permission Permission level, `0` is no permission, `1` is admin, `2` is group owner, `3` is global admin, `4` is xcb owner
 */
function setPermission(userId, groupId, permission) {
    if (permission > 2) groupId = 0;
    if (permission) pool.query({
        sql: getPermission(userId, groupId)
            ? 'update admin set permission = ? where qq = ? and qqgroup = ?'
            : 'insert into admin (permission, qq, qqgroup) values (?, ?, ?)',
        values: [permission, userId, groupId]
    }, err => {
        if (err) return logger.error(err.message);
        _.set(permissions, [userId, groupId], permission);
    });
    else pool.query('delete from admin where qq = ? and qqgroup = ?', [userId, groupId], err => {
        if (err) return logger.error(err.message);
        _.unset(permissions, [userId, groupId]);
    });
}

initProm.push(updatePermissionCache(false));

const users = {};

function getGroupsBelongsTo(qq) {
    return _.keys(users[qq]);
}

function updateGroupList(group, clearOld = true) {
    return new Promise(resolve => {
        getGroupMembers(group, list => {
            if (clearOld) _.forEach(users, value => delete value[group]);
            list.forEach(user => {
                _.setWith(users, [user.userId, group], ['member', 'admin', 'owner'].indexOf(user.role), Object);
            });
            resolve();
        });
    });
}

initProm.push(new Promise(resolve => {
    getGroupList(groups => {
        Promise.all(_.map(groups, group => updateGroupList(group.groupId, false))).then(resolve);
    });
}));

onMemberChange(event => {
    if (event.noticeType == 'group_decrease') _.unset(users, [event.userId, event.groupId]);
    else _.setWith(users, [event.userId, event.groupId], 0, Object);
}, 10);

onAdminChange(event => {
    _.setWith(users, [event.userId, event.groupId], event.subType == 'set' ? 1 : 0, Object);
}, 10);

onFriendRequest(event => {
    return authorized('user' + event.userId).size !== 0;
}, 10);

onInviteGroupRequest(event => {
    if (authorized('group' + event.groupId).size === 0) return false;
    setTimeout(() => updateGroupList(event.groupId, false), 1000);
    return true;
}, 10);

/**
 * Get permission in the QQ group
 * @param {number} userId QQ number
 * @param {number} groupId Group ID
 * @returns {-1|0|1|2} `0` if is member, `1` if is admin, `2` if is owner, `-1` if even isn't a member
 */
function getActualPermission(userId, groupId) {
    return _.get(users, [userId, groupId], -1);
}

module.exports = {
    modules,
    pool,
    shutdown,
    registerTag,
    parse,
    // Events
    onPrivateMessage,
    onGroupMessage,
    onDiscussMessage,
    onAdminChange,
    onMemberChange,
    onNewFriend,
    onFriendRequest,
    onJoinGroupRequest,
    onInviteGroupRequest,
    onRemoteLifecycle,
    onHeartbeat,
    removeListener,
    // Requests
    sendRequest,
    sendPrivateMessage,
    sendGroupMessage,
    sendDiscussMessage,
    revokeMessage,
    kickUser,
    banUser,
    banAnonymousUser,
    leaveGroup,
    leaveDiscuss,
    processFriendRequest,
    processAddGroupRequest,
    processGroupInvitation,
    getGroupList,
    getGroupMembers,
    // Permission
    authorized,
    getAuthorizationExpires,
    updateAuthorization,
    getPermission,
    setPermission,
    getActualPermission,
};
modules.core = module.exports;

Promise.all(initProm).then(() => {
    fs.readdirSync('./modules').filter(value => value.endsWith('.js')).forEach(fn => {
        fn = fn.substr(0, fn.length - 3);
        modules[fn] = require('./modules/' + fn);
    });
    return Promise.all(_.compact(_.map(modules, mod => {
        if (mod.load) {
            let rtn = mod.load();
            if (rtn instanceof Promise) return rtn.then(() => loaded.push(mod));
        }
    })));
}).then(() => http.createServer((request, response) => {
    let data = '';
    request.on('data', chunk => data += chunk);
    request.on('end', () => {
        let req = camelCaseKey(JSON.parse(data));
        logger.trace(req);

        let res;
        if (req.postType == 'message') {
            if (req.messageType == 'private') {
                res = emit(req, events.privateMessage, ret => ret !== false, reply => reply !== true ? ({reply}) : undefined);
            } else if (req.messageType == 'group') {
                res = emit(req, events.groupMessage, ret => ret !== false, reply => reply !== true ? ({reply, atSender: false}) : undefined);
            } else if (req.messageType == 'discuss') {
                res = emit(req, events.discussMessage, ret => ret !== false, reply => reply !== true ? ({reply, atSender: false}) : undefined);
            }
        } else if (req.postType == 'notice') {
            if (req.noticeType == 'group_admin') {
                res = emit(req, events.adminChanges);
            } else if (req.noticeType == 'group_decrease' || req.noticeType == 'group_increase') {
                res = emit(req, events.memberChanges);
            } else if (req.noticeType == 'friend_add') {
                res = emit(req, events.newFriend);
            }
        } else if (req.postType == 'request') {
            if (req.requestType == 'friend') {
                res = emit(req, events.friendRequest, ret => ret !== undefined, approve => typeof approve === 'string' ? {
                    approve: true,
                    remark: approve,
                } : { approve });
            } else if (req.requestType == 'group') {
                res = emit(req, req.subType == 'add' ? events.joinGroupRequest : events.inviteGroupRequest, ret => ret !== undefined, approve => typeof approve === 'string' ? {
                    approve: false,
                    reason: approve,
                } : { approve });
            }
        } else if (req.postType == 'meta_event') {
            if (req.metaEventType == 'lifecycle') {
                res = emit(req.subType, events.lifecycle);
            } else if (req.metaEventType == 'heartbeat') {
                res = emit(req, events.heartbeat);
            }
        }
        if (res) {
            logger.trace(res);
            response.write(JSON.stringify(snakeCaseKey(res)));
        } else response.writeHead(204);
        response.end();
    });
}).listen(process.env.PORT, process.env.HOST, () => {
    inited = true;
    logger.info('Server started.');
}));
