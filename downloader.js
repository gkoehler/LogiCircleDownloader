const debug = require('debug')('dsd');
const fs = require('fs');
const fetch = require('node-fetch');
const low = require('lowdb')
const FileAsync = require('lowdb/adapters/FileAsync')
const path = require('path');
const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));

const dateToString = (date) => {
    let year = date.getFullYear();
    let month = date.getMonth() + 1
    let day = date.getDate();
    
    if (month < 10) {
        month = "0" + month;
    }
    if (day < 10) {
        day = "0" + day;
    }
    
    return year + '-' + month + '-' + day;
}

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

const save_stream = async(filepath, stream) => {
    stream.pipe(fs.createWriteStream(filepath)).on('close', () => {
        debug('saved', filepath);
    });
};

const create_summary = async (accessory, sessionCookie, date) => {
    var dateStr = date.toISOString().split('T')[0];    //this formats the date to YYYY-mm-dd
    
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
                "maxPlaybackDuration": 60000,    //60000 is maximum
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

//creates and downloads day brief
const downloadDayBrief = async(accessory, sessionCookie) => {
    const download_directory = process.env.DOWNLOAD_DIRECTORY;
    
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() + settings.daybrief.dayOffset);    //set the dayOffset to -1 or 0 depending on when you are running this

    var ok = await create_summary(accessory, sessionCookie, yesterday);
    if(ok) {
        // debug("Summary created for " + accessory.name);
        var summaries = await get_summaries(accessory, sessionCookie);
        for (summary of summaries) {        
            let [filename, stream] = await download_summary(summary.summaryId, sessionCookie);
            
            let dir = download_directory;
            if(settings.daybrief.dateFolders){
                let date = dateToString(yesterday);

                if (!fs.existsSync(path.join(download_directory, date))) {
                    fs.mkdirSync(path.join(download_directory, date));
                }

                dir = path.join(download_directory, date);
            }

            if(settings.daybrief.deviceFolders){
                let pathWithDevice = path.join(dir, accessory.name);

                if (!fs.existsSync(pathWithDevice)) {
                    fs.mkdirSync(path.join(pathWithDevice));
                }

                dir = pathWithDevice;
            }

            let filepath = path.join(dir, filename);
                                
            debug(filepath);
            save_stream(filepath, stream);
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
        if(settings.devices.length > 0 && !(settings.devices.includes(accessory.accessoryId))) {
            debug('Skipping accessory ', accessory.accessoryId);
        } else {
            if (settings.daybrief.download) {
                downloadDayBrief(accessory, sessionCookie);
            }
            
            if (settings.activities.download) {            
                let activities = await get_activities(accessory, sessionCookie);
           
                for(activity of activities) {
                    let found = db.get('downloadedActivities').indexOf(activity.activityId) > -1;

                    if(!found && activity.relevanceLevel >= settings.activities.relevanceThreshold) {
                        let [filename, stream] = await download_activity(accessory, activity, sessionCookie);
                        let dir = download_directory;

                        if(settings.activities.dateFolders){
                            let activityDate = new Date(activity.startTime);
                            let date = dateToString(activityDate);
            
                            if (!fs.existsSync(path.join(download_directory, date))) {
                                fs.mkdirSync(path.join(download_directory, date));
                            }

                            dir = path.join(download_directory, date);
                        }

                        if(settings.activities.deviceFolders){
                            let pathWithDevice = path.join(dir, accessory.name);

                            if (!fs.existsSync(pathWithDevice)) {
                                fs.mkdirSync(path.join(pathWithDevice));
                            }

                            dir = pathWithDevice;
                        }
                        switch (activity.relevanceLevel) {
                            case 0:
								let lowPath = path.join(dir, "low");
								if (!fs.existsSync(lowPath)) {
                                    fs.mkdirSync(path.join(lowPath));
                                }
                                dir = lowPath;
                                break;
                            case 1:
							    let highPath = path.join(dir, "high");
								if (!fs.existsSync(highPath)) {
                                    fs.mkdirSync(path.join(highPath));
                                }
                                dir = highPath;
                                break;
                        }

                        let filepath = path.join(dir, filename);
                        
                        save_stream(filepath, stream);
						db.get('downloadedActivities').push(activity.activityId).write();
                    }
                }
            }
        }
    }
};

run()