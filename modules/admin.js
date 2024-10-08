const blocked = {};

function messageListener(event) {
    return false;
    let match;
    const permission = getPermission(event.userId, event.groupId);

    if (permission >= 1 && (match = event.message.match(/^解除禁言 *(?:\[CQ:at,qq=)?(\d+)\]?(?: +(\d+))?\s*$/u))) {
        match = match.map(Number);
        if (!match[2] && !event.groupId) return false;
        unban(match[1], match[2] || event.groupId);
        return '被大赦了哦';
    }

    if (permission >= 1 && (match = event.message.match(/^解除禁闭 *(?:\[CQ:at,qq=)?(\d+)\]?\s*$/u))) {
        unblock(Number(match[1]), event.groupId);
        return '被大赦了哦';
    }

    if (permission >= 1 && event.groupId && (match = event.message.match(/^禁言 *(?:\[CQ:at,qq=)?(\d+)\]? +(?:(?:(\d+)天)?(?:(\d+)小?时)?(?:(\d+)分钟?)?|(\d+))$/u))) {
        if (permission <= getPermission(match[1])) return '你的想法很大胆啊x';
        if (getActualPermission(event.selfId, event.groupId) <= getActualPermission(match[1], event.groupId)) return '套餐到不了账喵';
        match = _.defaults(match, {4: match[5]}, [0, 0, 0, 0, 0]).map(Number);
        let total = match[2] * 1440 + match[3] * 60 + match[4];
        if (total > 43200) total = 43200;
        blockAndBan(match[1], event.groupId, total * 60);
        let str = '的禁言套餐已到账', tmp = total;
        if (tmp % 60) str = (tmp % 60) + '分钟' + str;
        tmp = Math.floor(tmp / 60);
        if (tmp % 24) str = (tmp % 24) + '小时' + str;
        tmp = Math.floor(tmp / 24);
        if (tmp) str = tmp + '天' + str;
        return str;
    }

    if (permission >= 1 && (match = event.message.match(/^禁闭 *(?:\[CQ:at,qq=)?(\d+)\]? +(?:(?:(\d+)天)?(?:(\d+)小?时)?(?:(\d+)分钟?)?|(\d+))$/u))) {
        if (permission <= getPermission(match[1])) return '你的想法很大胆啊x';
        match = _.defaults(match, {4: match[5]}, [0, 0, 0, 0, 0]).map(Number);
        let total = match[2] * 1440 + match[3] * 60 + match[4];
        if (total > 43200) total = 43200;
        block(match[1], event.groupId, total * 60);
        let str = '的禁言套餐已到账', tmp = total;
        if (tmp % 60) str = (tmp % 60) + '分钟' + str;
        tmp = Math.floor(tmp / 60);
        if (tmp % 24) str = (tmp % 24) + '小时' + str;
        tmp = Math.floor(tmp / 24);
        if (tmp) str = tmp + '天' + str;
        return str;
    }

    if (permission >= 1 && (match = event.message.match(/^设置群(\d*)定时提醒([a-z0-9[\],;=]+):(.*)$/u))) {
        let group = _.defaultTo(parseInt(match[1]), event.groupId);
        if (getPermission(event.userId, group) < 1) return false;
        let tmp = match[2].split(';');
        for (let i = 0; i < tmp.length; ++i) {
            tmp[i] = tmp[i].split('=');
            if (['minutes', 'hours', 'day', 'date', 'month', 'year'].indexOf(tmp[i][0]) == -1) return `未知参数: ${tmp[i][0]}`;
            try {
                tmp[i][1] = tmp[i][1].indexOf(',') === -1 ? Number(tmp[i][1]) : tmp[i][1].split(',').map(Number);
                if (!_.isInteger(tmp[i][1]) && !tmp[i][1].every(_.isInteger)) throw new Error();
            } catch(e) {
                return `非法的整数列表: ${tmp[i][1]}`;
            }
        }
        let constraints = _.fromPairs(tmp);
        return '设置完成，计划ID: ' + setRegularSchedule(constraints, ['admin', 'sendMessage'], [group, match[3].replace(/&#(\d+);/g, (...match) => String.fromCharCode(match[1]))]);
    }

    if (permission >= 1 && (match = event.message.match(/^删除定时提醒(.+)$/u))) {
        return removeSchedule(match[1]) ? '计划已删除' : '计划不存在';
    }

    if (permission >= 2 && (match = event.message.match(/^(添加|设置|删除|取消|移除)(管理|群主|全局管理) *(?:\[CQ:at,qq=)?(\d+)\]?(?: +(\d+))?\s*$/u))) {
        const add = match[1] == '添加' || match[1] == '设置';
        const targetPermission = ({'管理': 1, '群主': 2, '全局管理': 3})[match[2]];
        const target = parseInt(match[3]);
        const targetGroup = _.defaultTo(parseInt(match[4]), event.groupId);
        if (targetPermission > permission) return '你的想法很大胆啊x';
        if (event.userId == target) {
            return '不要皮自己啊';
        } else if (add) {
            if (getPermission(target, targetGroup) >= targetPermission) {
                return '对方已经是管理了哦';
            } else {
                setPermission(target, targetGroup, targetPermission);
                return '设置成功';
            }
        } else {
            const currentPermission = getPermission(target, targetGroup);
            if (currentPermission >= permission) {
                return '你的想法很大胆啊x';
            } else if (currentPermission) {
                setPermission(target, targetGroup, 0);
                return '设置成功';
            } else {
                return '对方又不是管理了啦';
            }
        }
    }

    // if (permission >= 3 && (match = event.message.match(/^(个人|群)(\d+)续费(?:(.*?) )?(\d+)([月年])?$/u))) {
    //     const target = (match[1] == '群' ? 'group' : 'user') + match[2];
    //     let authtype = match[3];
    //     if (!authtype) {
    //         let auths = _.toPairs(getAuthorizationExpires(target));
    //         if (auths.length != 1) return '请指定授权类型';
    //         authtype = auths[0][0];
    //     }
    //     updateAuthorization(target, authtype, 'prolong', parseInt(match[4]), match[5] == '年' ? 'year' : 'month', success => {
    //         sendPrivateMessage(event.userId, success ? '续费成功，有效期至' + getAuthorizationExpires(target, authtype).toLocaleString() : '续费失败');
    //     });
    //     return true;
    // }

    return false;
}

/**
 * Block a user.
 * @param {number} userId QQ number
 * @param {number} groupId Group ID
 * @param {number} duration Time to block in seconds
 */
function block(userId, groupId, duration) {
    _.set(blocked, [userId, groupId], _.max([_.get(blocked, [userId, groupId]), new Date().getTime() + duration * 1000]));
}

/**
 * Block and ban a user. If group id is unavailable, the user won't be banned.
 * @param {number} userId QQ number
 * @param {number} groupId Group ID
 * @param {number} duration Time to block and ban
 */
function blockAndBan(userId, groupId, duration) {
    block(userId, groupId, duration);
    if (groupId) banUser(userId, groupId, duration);
}

/**
 * Check whether the user was blocked or not.
 * If the user was admin, this function will always returns false.
 * @param {number} userId QQ number
 * @param {number} [groupId=0] Group ID
 * @returns {boolean} Whether the user was blocked or not
 */
function isBlocked(userId, groupId = 0) {
    return false;
    return _.get(blocked, [userId, groupId], 0) > new Date() && getPermission(userId, groupId) == 0;
}

/**
 * Unblock a user.
 * @param {number} userId QQ number
 * @param {number} [groupId=0] Group ID
 */
function unblock(userId, groupId) {
    _.unset(blocked, [userId, groupId]);
}

/**
 * Unban a user.
 * @param {number} userId QQ number
 * @param {number} groupId Group ID
 */
function unban(userId, groupId) {
    unblock(userId, groupId);
    if (groupId) banUser(userId, groupId, 0);
}

/**
 * Parse and send group message
 * @param {number} groupId Group ID
 * @param {string} message Message
 */
function sendMessage(groupId, message) {
    sendGroupMessage(groupId, parse(message, 0, groupId, true));
}

module.exports = {
    load: () => {
        onPrivateMessage(messageListener, 100);
        onGroupMessage(messageListener, 100);
    },
    unload: () => {
        removeListener(messageListener);
    },
    block,
    blockAndBan,
    isBlocked,
    unblock,
    unban,
    sendMessage,
};

const _ = require('lodash');
const { sendPrivateMessage, sendGroupMessage, onPrivateMessage, onGroupMessage, removeListener, banUser, updateAuthorization, getPermission, setPermission, getActualPermission } = require('..');
const { setRegularSchedule, removeSchedule } = require('./schedule');
const { parse } = require('./parser');
