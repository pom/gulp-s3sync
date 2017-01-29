"use strict";
var AWS = require("aws-sdk");
var gutil = require("gulp-util");
var through = require("through2");
var crypto = require("crypto");
var PLUGIN_NAME = 'gulp-s3sync';
var _localFiles = [];
module.exports = function (bucket) {
    var s3 = new AWS.S3({ params: { Bucket: bucket } });
    var transform = function (file, encoding, callback) {
        if (file.isNull()) {
            return callback();
        }
        _localFiles.push(file.relative);
        callback(null, file);
        s3.headObject({ Bucket: bucket, Key: file.relative }, function (err, data) {
            if (err && err.statusCode !== 403 && err.statusCode !== 404) {
                throw new gutil.PluginError(PLUGIN_NAME, 'headObject error: ' + err.stack);
            }
            var shouldUpdate = false;
            if (data && !file.isStream()) {
                var eTag = data.ETag;
                var hash = crypto.createHash('md5');
                var localHash = file.pipe(hash).read().toString('hex');
                if (eTag == '"' + localHash + '"') {
                    gutil.log(gutil.colors.gray('Unchanged: '), file.relative);
                    return;
                }
                else {
                    shouldUpdate = true;
                }
            }
            var uploadParams = {
                Bucket: bucket,
                Key: file.relative,
                Body: file.contents
            };
            if (file.isStream()) {
                if (file.stat) {
                    uploadParams.ContentLength = file.stat.size;
                }
                else {
                    throw new gutil.PluginError(PLUGIN_NAME, 'cannot upload a stream object without know content-length');
                }
            }
            s3.putObject(uploadParams, function (err, data) {
                if (err) {
                    throw new gutil.PluginError(PLUGIN_NAME, 'putObject error: ' + err.stack);
                }
                if (shouldUpdate) {
                    gutil.log(gutil.colors.yellow('Updating: '), file.relative);
                }
                else {
                    gutil.log(gutil.colors.green('Uploading: '), file.relative);
                }
            });
        });
    };
    var flush = function (callback) {
        var s3 = new AWS.S3({ params: { Bucket: bucket } });
        s3.listObjectsV2({ Bucket: bucket }, function (err, data) {
            if (err) {
                return callback(new gutil.PluginError(PLUGIN_NAME, 'listObjectsV2 error: ' + err.stack));
            }
            var remoteFiles = data.Contents.map(function (obj) { return obj.Key; });
            var filesToDelete = remoteFiles.filter(function (file) { return (_localFiles.indexOf(file) < 0); });
            if (filesToDelete.length == 0) {
                return callback();
            }
            s3.deleteObjects({
                Bucket: bucket,
                Delete: { Objects: filesToDelete.map(function (file) { return { Key: file }; }) }
            }, function (err, data) {
                if (err) {
                    return callback(new gutil.PluginError(PLUGIN_NAME, 'deleteObjects error: ' + err.stack));
                }
                for (var _i = 0, _a = data.Deleted; _i < _a.length; _i++) {
                    var object = _a[_i];
                    gutil.log(gutil.colors.red('Deleted: '), object.Key);
                }
                callback();
            });
        });
    };
    return through.obj(transform, flush);
};
//# sourceMappingURL=main.js.map