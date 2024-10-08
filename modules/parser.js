const _ = require('lodash');
const process = require('process');
const { blockAndBan } = require('./admin');
const { setSingleSchedule } = require('./schedule');

/**
 * Convert a time string in the format of `[[dd:]hh:]mm[’ss]` to seconds.
 * @param {string} str Raw string
 * @returns {number|boolean} `false` if the string is invalid, otherwise returns seconds.
 */
function resolveTime(str) {
    let match = str.match(/^(?:(?:(\d+):)?(\d+):)?(\d+)(?:'(\d+))?$/);
    if (!match) return false;
    return match.slice(1, 5).reduce((prev, curr, index) => prev * (index == 1 ? 24 : 60) + Number(curr || 0), 0);
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
    let chain = text
        .replace(/%([\w_]+)%/g, (...match) => _.defaultTo(process.env[match[1]], ''))
        .replace(/\[br\]/g, '\n')
        .match(/\[([^\\\]]|\\.)*?\]|[^[]+/g)
        .map(str => {
            if (str[0] !== '[') return {
                type: 'Plain',
                text: str,
            };
            let match = str.match(/^\[(\w+)(?:=(.*))?\]$/);
            if (!match) return {
                type: 'Plain',
                text: str,
            };
            let [_, cmd, arg] = match;
            if (arg) arg = arg.replace(/\\(.)/, '$1');
            if (cmd == 'img' && !require('fs').existsSync(arg)) return;
            if (cmd == 'img' && arg !== undefined) return {
                type: 'Image',
                path: arg,
            };
            if (cmd == 'at' && arg !== undefined) return {
                type: 'At',
                target: +arg,
            };
            if (cmd == 'ban' && arg !== undefined) {
                let match2 = arg.match(/^([\d:']+)(?:\?(.*?))?$/);
                if (match2) {
                    let time = resolveTime(match2[1]);
                    if (time === false) return {
                        type: 'Plain',
                        text: str,
                    };
                    if (alt !== undefined) return; // Only deal with first ban command
                    if (match2[2] !== undefined) {
                        if (protect || !groupId) {
                            alt = [{
                                type: 'Plain',
                                text: match2[2],
                            }];
                            return;
                        }
                    }
                    if (groupId) blockAndBan(userId, groupId, time);
                    return;
                }
            }
            if (cmd == 'pm' && arg !== undefined) {
                let match2 = arg.match(/^(.+?)(?:\?([\d:']+))?$/);
                if (match2) {
                    let time = match2[2] ? resolveTime(match2[2]) : 0;
                    if (time === false) {
                        match2[1] += '?' + match2[2];
                        time = 0;
                    }
                    setSingleSchedule(time * 1000, ['core', 'sendPrivateMessage'], [userId, groupId, match2[1]]);
                    return;
                }
            }
            return {
                type: 'Plain',
                text: str,
            };
        });
    return alt || chain.filter(v => v);
}

exports.parse = parse;
