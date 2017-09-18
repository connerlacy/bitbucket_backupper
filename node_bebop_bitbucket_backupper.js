var   https = require('https');
const spawn = require('child_process').spawn;
const fs    = require('fs');
var   repos;
var   responseString;
var un; // Username
var pw; // Password
var date  = new Date();
var day   = date.getDay();
var month = date.getMonth();
var year  = date.getFullYear();
var time  = date.getTime();
var budir = 'backup_bebop_repos_' + year + '-' + (month + 1) + '-' + day + '_' + time;

var accountHandle   = "[BtBucketAccountNameHere]";
var backupDirectory = "[HDDName]";
var bucketName      = "[BucketNameHere"];

/**
	Confirm and delete
*/
//=======================================================================
function confirmAndDelete(filename)
{
	console.log('Removing ' + filename  + ' from local disk. ');
	
	fs.exists('/mnt/bebop_bitbucket_backups/' + filename, function (exists) {
		if(exists)
		{
			const rmFile = spawn('rm', ['-rf', filename]);

			rmFile.stdout.on('data', (data) => {
				console.log(`stdout: ${data}`);
			});

			rmFile.stderr.on('data', (data) => {
				console.log(`stderr: ${data}`);
			});

			rmFile.on('close', (code) => {
				console.log(filename + ' removed.');
				console.log('Backup complete.');
			});
		}
		else 
		{
			console.log('File does not exist on external drive. Exiting.');
		}
	});
}


/**
	Move to hard drive
*/
//=======================================================================
function moveToHardDrive(filename)
{	
	console.log('Moving ' + filename  + ' to hard drive. ');

	const mkdir = spawn('mv', [filename, '/mnt/' + backupDirectory + '/']);

	mkdir.stdout.on('data', (data) => {
		console.log(`stdout: ${data}`);
	});

	mkdir.stderr.on('data', (data) => {
		console.log(`stderr: ${data}`);
	});

	mkdir.on('close', (code) => {
		console.log(filename + ' moved.');
		confirmAndDelete(filename);
	});
}



/**
	Upload archive to AWS S3.
*/
//=======================================================================
function uploadToAWS(archivePath)
{
	var archiveName = archivePath;
	
	var AWS = require('aws-sdk');
	var fs  = require('fs');
	
	// !!! This should always be kept private/local
	var s3Config = fs.readFileSync("s3Config.json");
	
	console.log('reading file : ' + archiveName);
	
	var s3 = new AWS.S3(s3Config);
	

	var fileStream = fs.createReadStream(archiveName);
	fileStream.on('error', function (err) {
		console.log("Console error: ", err);
	});
	
	var uploadParams = 
	{
		Bucket: bucketName,
		Key: archiveName,
		Body: fileStream	
	};
	
	s3.upload (uploadParams, function (err, data) {
		if (err) {
			console.log("Error", err);
		} if (data) {
			console.log("Upload Success", data.Location);
			moveToHardDrive(archiveName);
		}
	});
}

/**
    Create backup directory.
*/
//=======================================================================
function createBackupDirectory()
{	
	console.log('Creating backup directory ' + budir + '.');

	const mkdir = spawn('mkdir', [budir]);

	mkdir.stdout.on('data', (data) => {
		console.log(`stdout: ${data}`);
	});

	mkdir.stderr.on('data', (data) => {
		console.log(`stderr: ${data}`);
	});

	mkdir.on('close', (code) => {
		console.log('Directory creation attempt complete.');
		bitBucketRequest();
	});
}



/**
	Clone repos sequentially.
*/
//=======================================================================
function cloneNextRepo(index)
{
	if(index < repos.length)
	{
		console.log('\n' + 'Cloning repo ' + (index+1) + '/' + repos.length + ' : ' + repos[index].name + ' ...');
		
		var repoUrl = 'https://' + un + ':' + pw + '@bitbucket.org/bebopsensors/' + repos[index].name;

		const clone = spawn('git', ['clone', repoUrl, budir + '/' + repos[index].name]);
		
		clone.stdout.on('data', (data) => {
			console.log(`stdout: ${data}`);
		});

		clone.stderr.on('error', (data) => {
			console.log(`stderr: ${data}`);
		});

		clone.on('close', (code) => {
			finishedCloningRepo(index);
		});
	}
	else 
	{
		zipFolder(budir);
	}
}

function finishedCloningRepo(index) 
{
	console.log('Finished cloning ' + repos[index].name);
	
	if(index < repos.length)
	{
		cloneNextRepo(index + 1);
	}
}

function zipFolder(filename) 
{
	console.log("Repos cloned. Zipping...");
	
	const zip = spawn('tar', ['czf', filename + '.tar.gz', filename]);
	
	zip.stdout.on('data', (data) => {
		//console.log(`${data}`);
	});

	zip.on('close', (code) => {
		console.log('Zip attempt complete. Uploading to AWS...');
		uploadToAWS(filename + '.tar.gz');
	});
}


/**
	Make the https request via the BitBucket REST API.
	
	Begin cloning upon
*/
//=======================================================================
function bitBucketRequest()
{
	console.log('Requesting info from BitBucket...');

	var options = 
	{
		hostname:  'api.bitbucket.org',
		path:      '/1.0/users/' + accountHandle,
		port:      443,
		auth:      un+':'+pw
	};

	var req = https.request(options, (res) => {
		
		res.on('data', (d) => {
			if (typeof d !== 'undefined') {
				responseString += d;
			}
		});
		
		res.on('end', (wd) => {
			var p = JSON.parse(responseString.replace('undefined',''));
			repos = p.repositories;
			console.log('Preparing to clone ' + p.repositories.length + ' repositories...');
			
			if(repos.length > 0)
			{
				cloneNextRepo(0);
			}
		});
	});

	req.on('error', (e) => {
		console.error(e);
	});

	req.end();
	
}




/**
    Get username and password
*/
//=======================================================================
var readline = require('readline');
var Writable = require('stream').Writable;



function getPassword(callback)
{
	var mutableStdout = new Writable({
		write: function(chunk, encoding, callback) {
			if (!this.muted)
			{
				process.stdout.write(chunk, encoding);
				callback();
			}
		}
	});

	mutableStdout.muted = false;

	var rlPass = readline.createInterface({
		input: process.stdin,
		output: mutableStdout,
		terminal: true
	});

	rlPass.question('BitBucket Password: ', function(pwd) {
		pw = pwd;
		
		if(pw != undefined)
		{
			createBackupDirectory();
		}
		
		rlPass.close();
		
	});

	mutableStdout.muted = true;
}

function getUsername(callback)
{
	var rlUserName = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true
	});

	rlUserName.question('BitBucket Username: ', function(usrnm) {
		un = usrnm;
		rlUserName.close();
		callback();
		
	});
}


/**
    main(), where the magic happens.
*/
//=======================================================================
function main()
{
	// Get credentials
	getUsername(getPassword);
}

main();

