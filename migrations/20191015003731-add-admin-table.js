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
    db.createTable('admin', {
        id: { type: type.INTEGER, primaryKey: true, autoIncrement: true },
        qq: { type: type.BIGINT, notNull: true },
        qqgroup: { type: type.BIGINT, notNull: true },
        permission: { type: 'tinyint', notNull: true },
    }, err => {
        if (err) return callback(err);
        db.addIndex('admin', 'perm', ['qq', 'qqgroup'], true, callback);
    });
};

exports.down = function (db, callback) {
    db.dropTable('admin', callback);
};

exports._meta = {
    'version': 1
};
