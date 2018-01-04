const debug = require('debug')('dsd');
const fs = require('fs');
const fetch = require('node-fetch');


const run = async() => {
    const user = {
        email: process.env.LOGI_EMAIL,
        password: process.env.LOGI_PASS
    };

    let authResponse = await fetch('https://video.logi.com/api/accounts/authorization', {
        method: 'POST',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(user)
    });

    let cookie = authResponse.headers.get('set-cookie');
    let sessionCookie = cookie.match(/prod_session=[^;]+/)[0];

    var accessories = await fetch('https://video.logi.com/api/accessories', {
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Cookie': sessionCookie
        }
    })
    .then(response => response.json());

    for(accessory of accessories) {
        var activitiesResponse = await fetch(`https://video.logi.com/api/accessories/${accessory.accessoryId}/activities`, 
        {
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'Cookie': sessionCookie
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

        for(activity of activitiesResponse.activities) {
            let url = `https://video.logi.com/api/accessories/${accessory.accessoryId}/activities/${activity.activityId}/mp4`;
            debug(`downloading ${url}`);
            await fetch(url, {
                headers: {
                    'Cookie': cookie
                }
            }).then(response => {
                let contentDisposition = response.headers.get('content-disposition');
                let filename = contentDisposition.match(/filename=([^;]+)/)[1];
                response.body.pipe(fs.createWriteStream('downloads/' + filename)).on('close', () => {
                    debug('saved', filename);
                });
            });
        }
    }
    
};

run()