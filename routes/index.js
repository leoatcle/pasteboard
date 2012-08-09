var knox = require("knox"),
	formidable = require("formidable"),
	microtime = require("microtime"),
	fs = require('fs'),
	amazonAuth = {},
	knoxClient = null;

try	{
	amazonAuth = require("../auth/amazon.js");
} catch (e) {}

if (amazonAuth.S3_KEY && amazonAuth.S3_SECRET && amazonAuth.S3_BUCKET) {
	knoxClient = knox.createClient({
			key: amazonAuth.S3_KEY,
			secret: amazonAuth.S3_SECRET,
			bucket: amazonAuth.S3_BUCKET
		});
}

/* GET home page */
exports.index =  function(req, res){
	res.render("index", { title: "Pasteboard", port: req.app.get("port") });
};

/* POST, preuploads an image and stores it in /tmp */
exports.preupload = function(req, res) {
	var form = new formidable.IncomingForm(),
		incomingFiles = [];
	
	form.parse(req, function(err, fields, files) {
		var client = req.app.get("clients")[fields.id];
		if (client) {
			if (client.file) {
				// Remove the old file
				fs.unlink(client.file.path);
			}
			// Keep track of the current pre-uploaded file
			client.file = files.file;
		}
		res.send("Received file");

	});
	form.on("fileBegin", function(name, file) {
		incomingFiles.push(file);
	});
	form.on("aborted", function() {
		// Remove temporary files that were in the process of uploading
		for (var i = 0; i < incomingFiles.length; i++) {
			fs.unlink(incomingFiles[i].path);
		}
	});
};

/* POST, removes a preuploaded file from the given client ID */
exports.clearfile = function(req, res) {
	var form = new formidable.IncomingForm();
	form.parse(req, function(err, fields, files) {
		var client = req.app.get("clients")[fields.id];
		if (client && client.file) {
			fs.unlink(client.file.path);
			client.file = null;
		}
		res.send("Cleared");
	});
};

/* POST, uploads a file to Amazon S3.
   If a file has been preuploaded, upload that, else
   upload the file that should have been posted with this request */

exports.upload = function(req, res) {
	if (knoxClient) {
		var form = new formidable.IncomingForm(),
			incomingFiles = [];

		form.parse(req, function(err, fields, files) {
			var client,
				file,
				fileExt,
				filePath;

			if (fields.id) {
				client = req.app.get("clients")[fields.id];
			}

			// Check for either a posted or preuploaded file
			if (files.file) {
				file = files.file;
			} else if (client && client.file && !client.uploading[client.file.path]) {
				file = client.file;
				client.uploading[file.path] = true;
			}
			if (file) {
				fileExt = file.type.replace("image/", "");
				// Prefix with rm_ so that an Amazon S3 file expiration filter can be used
				filePath = "/images/rm_" + microtime.now() + "." + (fileExt === "jpeg" ? "jpg" : fileExt);

				knoxClient.putFile(
					file.path,
					filePath,
					{ "Content-Type": file.type },
					function(err, putRes) {
						if (putRes) {
							var url = "http://" + amazonAuth.S3_BUCKET + ".s3.amazonaws.com" + filePath;
							fs.unlink(file.path); // Remove tmp file

							if (putRes.statusCode === 200) {
								res.json({url: url});
							} else {
								console.log("Error: ", err);
								res.send("Failure", putRes.statusCode);
							}
						}
				});
			} else {
				res.send("Missing file", 500);
			}
		});
		form.on("fileBegin", function(name, file) {
			incomingFiles.push(file);
		});
		form.on("aborted", function() {
			// Remove temporary files that were in the process of uploading
			for (var i = 0; i < incomingFiles.length; i++) {
				fs.unlink(incomingFiles[i].path);
			}
		});
	} else {
		console.log("Missing Amazon S3 credentials (/auth/amazon.js)");
		res.send("Missing Amazon S3 credentials", 500);
	}
};
