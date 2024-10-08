const _ = require('lodash');
const assert = require('assert');
const fs = require('fs');
const log4js = require('log4js');
const modules = require('../index').modules;

let schedules = [];

const logger = log4js.getLogger('schedule');

function call(callback, params) {
    let cb;
    try {
        cb = callback.reduce((prev, curr) => prev[curr], modules);
        assert(typeof cb === 'function');
    } catch (err) {
        return;
    }
    cb(...params);
}

function genID(len = 5) {
    let rtn;
    do {
        rtn = Math.floor(Math.random() * Math.pow(34, len)).toString(34).replace(/0/g, 'y').replace(/l/g, 'z').padStart(len, '1');
    } while (_.some(schedules, ['id', rtn]));
    return rtn;
}

function validate(value, key, maxdate) {
    if (!_.isInteger(value)) throw new Error(`Illegal argument: ${key} should be integrity, but got ${value}`);
    const min = {
            second: 0,
            minute: 0,
            hour: 0,
            day: 0,
            date: 1,
            month: 0,
        }[key], max = {
            second: 59,
            minute: 59,
            hour: 23,
            day: 6,
            date: maxdate,
            month: 11,
        }[key];
    if (value < min || value > max) throw new Error(`Illegal argument: ${key} should be between ${min} and ${max}, but got ${value}`);
}

function addTime(date, changes) {
    date['set' + changes[0]](date['get' + changes[0]]() + changes[1]);
}

function nextTime(time) {
    let test = new Date();
    test.setMilliseconds(1000);
    test.setSeconds(60);
    if (_.has(time, 'month')) {
        time = _.defaults(time, { minutes: 0, hours: 0 });
        if (!_.has('day') && !_.has('date')) time.date = 0;
    } else if (_.has(time, 'date') || _.has(time, 'day')) time = _.defaults(time, { minutes: 0, hours: 0 });
    else if (_.has(time, 'hours')) time = _.defaults(time, { minutes: 0 });
    let changes;
    [
        ['minutes', ['Hours', 1], 'Minutes'],
        ['hours', ['Date', 1], 'Hours'],
        ['day', ['Date', 7], 'Date'],
        ['date', ['Month', 1], 'Date'],
        ['month', ['Year', 1], 'Month'],
    ].forEach(value => {
        if (_.has(time, value[0])) {
            if (typeof time[value[0]] === 'number') {
                changes = value[1];
                if (test['get' + _.upperFirst(value[0])]() > time[value[0]]) addTime(test, changes);
                value[0] === 'day' ? test.setDate(test.getDate() + time.day - test.getDay()) : test['set' + _.upperFirst(value[0])](time[value[0]]);
            } else {
                changes = [value[2], 1];
            }
        }
    });
    let testTime = 0;
    while (_.some(time, (value, key) => {
        let tmp = test[`get${_.upperFirst(key)}`]();
        return typeof value === 'number' ? value !== tmp : value.indexOf(tmp) === -1;
    })) {
        if (++testTime > 1e5) throw new Error(`Failed matching constraints: ${JSON.stringify(time)}`);
        addTime(test, changes);
    }
    return test;
}

/**
 * Set a regular schedule
 * @param {Object} time Time to schedule. For example `{day: [0, 5, 6], hour: 18}` will be scheduled at every 18:00 on Friday, Saturday and Sunday.
 * @param {number|number[]} [time.minutes] Minute, 0~59
 * @param {number|number[]} [time.hours] Hour, 0~23
 * @param {number|number[]} [time.day] Day of week, 0~6
 * @param {number|number[]} [time.date] Date of month, 1~31
 * @param {number|number[]} [time.month] Month, 0~11
 * @param {string[]} callback Method to call, for example `['core', 'sendPrivateMessage']`
 * @param {*[]} params Parameters to pass, for example `[10000, 'Message']`
 * @param {string} [id] Specify a unique ID, or a random ID will be generated
 * @returns {string} Schedule ID
 */
function setRegularSchedule(time, callback, params, id) {
    time = _.pick(time, ['minutes', 'hours', 'day', 'date', 'month', 'year']);
    if (_.isEmpty(time)) throw new Error('Time cannot be empty');
    const maxdate = _.max(time.month === undefined ? [31] : (typeof time.month === 'number' ? [time.month] : time.month).map(month => month == 2 ? 29 : (month ^ month > 7) & 1 ? 31 : 30));
    _.forEach(time, (value, key) => {
        if (typeof value === 'number') validate(value, key, maxdate);
        else value.forEach(_.bind(validate, _, _, key, maxdate));
    });
    if (id) removeSchedule(id);
    const renew = () => { // Closure
        obj.timeoutId = setTimeout(renew, nextTime(time) - new Date());
        call(callback, params);
    };
    const obj = {
        id: id || genID(),
        time, callback, params,
        timeoutId: setTimeout(renew, nextTime(time) - new Date()),
    };
    schedules.push(obj);
    return obj.id;
}

/**
 * Set a singluar schedule
 * @param {number|Date} delay Delay in milliseconds, or specified time
 * @param {string[]} callback Method to call, for example `['core', 'sendPrivateMessage']`
 * @param {*[]} params Parameters to pass, for example `[10000, 'Message']`
 * @param {*[]} [failparams] Parameters to pass if schedule was missed. Default is to ignore failed schedules
 * @param {string[]} [failcallback] Method to call if schedule was missed. Default is same to callback
 * @returns {string} Schedule ID
 */
function setSingleSchedule(delay, callback, params, failparams, failcallback) {
    const obj = {
        id: genID(),
        time: delay instanceof Date ? delay : new Date().getTime() + delay,
        callback, params, failcallback, failparams,
        timeoutId: setTimeout(() => {
            call(callback, params);
            schedules.splice(schedules.indexOf(obj), 1);
        }, delay instanceof Date ? delay.getTime() - delay : delay)
    };
    schedules.push(obj);
    return obj.id;
}

/**
 * Find whether the schedule exists
 * @param {string} id Schedule ID
 * @returns {boolean} Whether the schedule exists
 */
function hasSchedule(id) {
    return _.some(schedules, ['id', id]);
}

/**
 * Remove specified schedule
 * @param {string} id Schedule ID 
 * @returns {boolean} Whether the schedule was existed and removed
 */
function removeSchedule(id) {
    if (!hasSchedule(id)) return false;
    let schedule = _.find(schedules, ['id', id]);
    if (schedule.timeoutId) clearTimeout(schedule.timeoutId);
    _.remove(schedules, ['id', id]);
    return true;
}

exports.load = () => {
    return new Promise(resolve => {
        fs.readFile('data/schedule.json', (err, data) => {
            if (schedules.length) exports.unload();
            if (err) return resolve();
            JSON.parse(data).forEach(schedule => {
                if (typeof schedule.time == 'number') {
                    if (schedule.time >= new Date().getTime()) {
                        setSingleSchedule(schedule.time - new Date().getTime(), schedule.callback, schedule.params, schedule.failcallback, schedule.failparams);
                    } else {
                        if (schedule.failparams) call(schedule.failcallback, schedule.failparams);
                    }
                } else {
                    setRegularSchedule(schedule.time, schedule.callback, schedule.params, schedule.id);
                }
            });
            logger.info('Module loaded.');
            resolve();
        });
    });
};

exports.unload = () => {
    return new Promise(resolve => {
        fs.exists('data', exists => {
            if (!exists) fs.mkdirSync('data');
            schedules.forEach(schedule => {
                if (schedule.timeoutId) {
                    clearTimeout(schedule.timeoutId);
                    delete schedule.timeoutId;
                }
            });
            fs.writeFile('data/schedule.json', JSON.stringify(schedules), err => {
                if (err) return logger.error(err.message);
                schedules = [];
                logger.info('Module unloaded.');
                resolve();
            });
        });
    });
};

exports.setRegularSchedule = setRegularSchedule;
exports.setSingleSchedule = setSingleSchedule;
exports.hasSchedule = hasSchedule;
exports.removeSchedule = removeSchedule;
