'use strict';

var dbm;
var type;

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function (options) {
    dbm = options.dbmigrate;
    type = dbm.dataType;
};

exports.up = function (db, callback) {
    db.createTable('auth', {
        id: { type: type.INTEGER, primaryKey: true, autoIncrement: true },
        target: { type: type.BIGINT, notNull: true },
        isgroup: { type: type.BOOLEAN, notNull: true },
        trailAvail: { type: type.BOOLEAN, notNull: true, defaultValue: 1 },
        expire: { type: type.DATE_TIME, notNull: true, defaultValue: '1970-01-01 00:00:00' },
        type: { type: 'varchar', notNull: true },
    }, err => {
        if (err) return callback(err);
        db.addIndex('auth', 'target', ['target', 'isgroup', 'type'], true, callback);
    });
};

exports.down = function (db, callback) {
    db.dropTable('auth', callback);
};

exports._meta = {
    'version': 1
};
