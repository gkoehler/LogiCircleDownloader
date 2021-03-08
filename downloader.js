const debug = require('debug')('dsd');
const fs = require('fs');
const fetch = require('node-fetch');
const low = require('lowdb')
const FileAsync = require('lowdb/adapters/FileAsync')
const path = require('path');
const { exec } = require('child_process');

const authorize = async (user) => {
    let authResponse = await fetch('https://video.logi.com/api/accounts/authorization', {
        method: 'POST',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Origin': 'https://circle.logi.com'
        },
        body: JSON.stringify(user)
    });

    let cookie = authResponse.headers.get('set-cookie');
    let sessionCookie = cookie.match(/prod_session=[^;]+/)[0];
    return sessionCookie;
};

const get_accessories = async (sessionCookie) => {
    return await fetch('https://video.logi.com/api/accessories', {
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Cookie': sessionCookie,
            'Origin': 'https://circle.logi.com'
        }
    })
    .then(response => response.json());
};

const get_activities = async (accessory, sessionCookie) => {
    let activitiesResponse = await fetch(`https://video.logi.com/api/accessories/${accessory.accessoryId}/activities`, 
    {
        method: 'POST',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Cookie': sessionCookie,
            'Origin': 'https://circle.logi.com'
        },
        body: JSON.stringify({
            "extraFields": [
                "activitySet"
            ],
            "operator": "<=",
            "limit": 80,
            "scanDirectionNewer": true,
            "filter": "relevanceLevel = 0 OR relevanceLevel >= 1"
        })
    }).then(response => response.json());

    return activitiesResponse.activities;
};

const download_activity = async(accessory, activity, sessionCookie) => {
    let url = `https://video.logi.com/api/accessories/${accessory.accessoryId}/activities/${activity.activityId}/mp4`;
    //debug(`downloading ${url}`);

    return await fetch(url, {
        headers: {
            'Cookie': sessionCookie,
            'Origin': 'https://circle.logi.com'
        }
    }).then(response => {
        let contentDisposition = response.headers.get('content-disposition');
        let filename = contentDisposition.match(/filename=([^;]+)/)[1];
        return [filename, response.body];
    });
};

const save_stream = async(filepath, stream) => {
    stream.pipe(fs.createWriteStream(filepath)).on('close', () => {
        debug('saved', filepath);
    });
};

const combinePath = function(folder, subFolder) {
	let dir = path.join(folder, subFolder);
	if (!fs.existsSync(dir))
		 fs.mkdirSync(dir);
	return dir;
}

const create_summary = async (accessory, sessionCookie, date) => {
	var dateStr = date.toISOString().split('T')[0];	//this formats the date to YYYY-mm-dd
	
    var summaryResponse = await fetch(`https://video.logi.com/api/accessories/${accessory.accessoryId}/summary`, {
		method: 'POST',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Cookie': sessionCookie,
            'Origin': 'https://circle.logi.com'
        },
		body: JSON.stringify({
			"summaryDescription": {
				"maxPlaybackDuration": 60000,	//60000 is maximum
				"showOnlyFiller":false,
				"timeSegments": [ {
					"startTime": dateStr + "T00:00:00Z",
					"endTime": dateStr + "T23:59:59Z",
					"entityDescriptions": [{
						"entities": ["all"]
					}]
				}]
			}
		})
    });
	
	return summaryResponse.ok;
};

const get_summaries = async(accessory, sessionCookie) => {
	let summariesResponse = await fetch(`https://video.logi.com/api/accessories/${accessory.accessoryId}/summary`, {
		method: 'GET',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Cookie': sessionCookie,
            'Origin': 'https://circle.logi.com'
        }
    }).then(response => response.json());
	
	return summariesResponse.summaries;	
};

const download_summary = async(summaryId, sessionCookie) => {
	let url = `https://video.logi.com/api/summary/${summaryId}/mp4`;
    debug(`downloading ${url}`);

    return await fetch(url, {
        headers: {
            'Cookie': sessionCookie,
            'Origin': 'https://circle.logi.com'
        }
    }).then(response => {
        let contentDisposition = response.headers.get('content-disposition');
        let filename = contentDisposition.match(/filename=([^;]+)/)[1];
        return [filename, response.body];
    });
};

//creates and downloads summery for yesterday
const downloadSummariesFromYesterday = async(accessory, sessionCookie) => {
	const download_directory = process.env.DOWNLOAD_DIRECTORY;
	
	var yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);

	var ok = await create_summary(accessory, sessionCookie, yesterday);
	if(ok) {
		debug("Summary created for " + accessory.name);
		var summaries = await get_summaries(accessory, sessionCookie);
		for (summary of summaries) {		
			let [filename, stream] = await download_summary(summary.summaryId, sessionCookie);
			
			//extracts the date from the filename
			let dateFilename = filename.substr(filename.indexOf("DayBrief_") + 9);
			let year = dateFilename.substr(0, 4);
			let month = dateFilename.substr(4, 2);
			let day = dateFilename.substr(6, 2);
			let datetime = year + month + day + dateFilename.substr(9, 4);
			
			//combines the date to a filepath YYYY/mm/filename.mp4
			let yearPath = combinePath(download_directory, year); 
			let monthPath = combinePath(yearPath, month);			
			let filepath = path.join(monthPath, filename);
								
			debug(filepath);
			save_stream(filepath, stream);
			exec('touch -t ' + datetime + ' ' + filepath);
		}
	}
};

const run = async() => {
    const user = {
        email: process.env.LOGI_EMAIL,
        password: process.env.LOGI_PASS
    };
	const download_directory = process.env.DOWNLOAD_DIRECTORY;
	const db = await low(new FileAsync('db.json'));

    await db.defaults({ downloadedActivities: [] }).write()

    let sessionCookie = await authorize(user);

    let accessories = await get_accessories(sessionCookie);

    for(accessory of accessories) {
		//download the summery for yesterday
		downloadSummariesFromYesterday(accessory, sessionCookie);
		
        let activities = await get_activities(accessory, sessionCookie);
        
        for(activity of activities) {
            let found = db.get('downloadedActivities').indexOf(activity.activityId) > -1;
			
            if(!found) {
                let [filename, stream] = await download_activity(accessory, activity, sessionCookie);
				filename = filename.replace(".mp4", "_" + activity.relevanceLevel + ".mp4");
				
				let dateFilename = filename.substr(filename.indexOf("_") + 1);
				let year = dateFilename.substr(0, 4);
				let month = dateFilename.substr(4, 2);
				let day = dateFilename.substr(6, 2);
				let datetime = year + month + day + dateFilename.substr(9, 4);
				
				let yearPath = combinePath(download_directory, year); 
				let monthPath = combinePath(yearPath, month);
				
				let filepath = path.join(monthPath, filename);
				switch (activity.relevanceLevel) {
					case 0:
						filepath = path.join(combinePath(monthPath, "low"), filename);
						break;
					case 1:
						filepath = path.join(combinePath(monthPath, "high"), filename);
						break;
				}
				
                save_stream(filepath, stream);
				exec('touch -t ' + datetime + ' ' + filepath);
                db.get('downloadedActivities').push(activity.activityId).write();
            }
        }

    }
};

run()
