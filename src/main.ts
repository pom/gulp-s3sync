import AWS = require('aws-sdk');
import gutil = require('gulp-util');
import through = require('through2');
import crypto = require('crypto');

const PLUGIN_NAME = 'gulp-s3sync';

let _localFiles: string[] = [];

export = function (bucket: string): any {
	let s3 = new AWS.S3({params: {Bucket: bucket}});

	let transform = function(file: any, encoding: string, callback: any) {
		if (file.isNull()) {
			callback();
		}

		// Remember we have seen this file and push down the pipeline
		_localFiles.push(file.relative);
		this.push(file);

		// FIXME: Investigate listing all remote objects first to gather the list of all ETags in one HTTP request
		s3.headObject({Bucket: bucket, Key: file.relative}, (err, data) => {
			if (err && err.statusCode !== 403 && err.statusCode !== 404) {
				callback(new gutil.PluginError(PLUGIN_NAME, 'headObject error: ' + err.stack));
				return;
			}

			// The file is already present. Let's hash our local copy and compare with the ETag
			let shouldUpdate = false;
			if (data && !file.isStream()) {
				let eTag = data.ETag;
				let hash = crypto.createHash('md5');
				let localHash = file.pipe(hash).read().toString('hex');

				if (eTag == '"' + localHash + '"') {
					gutil.log(gutil.colors.gray('Unchanged: '), file.relative);
					return callback();
				} else {
					shouldUpdate = true;
				}
			}

			let uploadParams: any = {
				Bucket: bucket,
				Key: file.relative,
				Body: file.contents
			};

			if (file.isStream()) {
				if (file.stat) {
					uploadParams.ContentLength = file.stat.size;
				} else {
					return callback(new gutil.PluginError(PLUGIN_NAME, 'cannot upload a stream object without know content-length'));
				}
			}

			s3.putObject(uploadParams, (err, data) => {
				if (err) {
					return callback(new gutil.PluginError(PLUGIN_NAME, 'putObject error: ' + err.stack));
				}

				if (shouldUpdate) {
					gutil.log(gutil.colors.yellow('Updating: '), file.relative);
				} else {
					gutil.log(gutil.colors.green('Uploading: '), file.relative);
				}
				callback();
			});
		});
	};

	let flush = function(callback: any) {
		let s3 = new AWS.S3({params: {Bucket: bucket}});

		// Compare list of local and remote files
		// Delete remote files that are not in the list
		s3.listObjectsV2({Bucket: bucket}, (err, data) => {
			if (err) {
				return callback(new gutil.PluginError(PLUGIN_NAME, 'listObjectsV2 error: ' + err.stack));
			}

			let remoteFiles = data.Contents.map(obj => obj.Key);
			let filesToDelete: string[] = remoteFiles.filter(file => (_localFiles.indexOf(file) < 0));

			if (filesToDelete.length == 0) {
				return callback();
			}

			s3.deleteObjects({
				Bucket: bucket,
				Delete: {Objects: filesToDelete.map(file => { return {Key: file} })}
			}, (err, data) => {
				if (err) {
					return callback(new gutil.PluginError(PLUGIN_NAME, 'deleteObjects error: ' + err.stack));
				}
				for (let object of data.Deleted) {
					gutil.log(gutil.colors.red('Deleted: '), object.Key);
				}
				callback();
			});
		});
	}

	return through.obj(transform, flush);
};
