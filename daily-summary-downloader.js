const puppeteer = require('puppeteer')
const debug = require('debug')('dsd')
const fs = require('fs')
const fetch = require('node-fetch')
const path = require('path')

// convert cookie object to a name=value string
// via https://github.com/mickdekkers/episodecalendar-exporter/blob/81f04e84c87bdeee1e67d0dc2b41d2b5960fdf2e/index.js#L96-L100
const stringifyCookies = ({ name, value }) => `${name}=${value}`

const streamCompletion = stream =>
    new Promise((resolve, reject) => {
        stream.on('end', resolve)
        stream.on('finish', resolve)
        stream.on('error', reject)
})

const getDailyBrief = async (user, downloadPath) => {

    const browser = await puppeteer.launch({ headless:true }) // change to "false" to inspect

    const page = await browser.newPage()
    
    await page._client.send('Page.setDownloadBehavior', { behavior: "allow", downloadPath: downloadPath })

    await page.goto('https://circle.logi.com')
    
    debug('logging in')
    await page.focus('#emailInput')
    await page.type(user.email)
    await page.focus('#passwordInput')
    await page.type(user.password)

    await page.waitFor(5000)
    await page.click('.krypto-login__button button')

    // waitForNavigation doesn't work in this app, neither does a waitFor(), so we do this:
    await new Promise(resolve => setTimeout(() => resolve(), 15000))
    
    debug('dismissing "subscribe" prompt')
    await page.click('button.krypto-modalWindow__button')
    await page.waitFor(5000)

    debug('click camera area')
    await page.click('.krypto-cameraBody__uiWrapper')
    await page.waitFor(1000)

    debug('clicking "daily brief"')
    await page.click('.krypto-timelineBubble_dayBriefToday')
    await page.waitFor(5000)

    debug('clicking "generate"')
    await page.click('.krypto-dayBrief__wrapper_clickable')
    await page.waitFor(20000)

    debug('dismiss modal') // "we couldn't play your daily brief"
    await page.click('.krypto-modalWindow__button:nth-child(2)') // "ok, no problem"
    await page.waitFor(2000)

    // only works with "headless:false":
    debug('download')

    await page.click('a.krypto-videoPlayerControls__icon_download')

    await page.waitFor(30000)
    // debug('click camera area')
    // await page.click('.krypto-cameraBody__uiWrapper')
    // await page.waitFor(1000)

    // const downloadLink = await page.$('a.krypto-videoPlayerControls__icon_download')
    // const downloadURL = downloadLink.href
    // debug('download url: ' + downloadURL)

    // return { 
    //     dailySummaryDownloadUrl: downloadURL,
    //     cookies: await page.cookies() 
    // }

    debug('close')
    await page.close()
    await browser.close()

}


const run = async() => {
    const user = {
        email: process.env.LOGI_EMAIL,
        password: process.env.LOGI_PASS
    }

    // debug("starting login")
    // const loginData = await login(user)

    // const dailyBriefPath = `${}.`
    const downloadPath = path.resolve(__dirname, 'downloads')
    debug("starting getDailyBrief")
    await getDailyBrief(user, downloadPath)

    // debug("starting download")
    // const dailySummaryDownload = await fetch(loginData.dailySummaryDownloadUrl, {
    //     headers: {
    //         Cookie: stringifyCookies(loginData.cookies)
    //     }
    // })

    // if (dailySummaryDownload.status !== 200) {
    //     throw new Error(`Unexpected response: ${dailySummaryDownload.status}`)
    // }

    // const d = new Date()
    // const filename = `DayBrief_${d.getFullYear()}-${d.getMonth()}-${d.getDate()}_${d.getHours()}_${d.getMinutes()}_${d.getSeconds()}.mp4`
    // const file = fs.createWriteStream(filename)
    
    // debug(`downloading video to ${filename}`)

    // await streamCompletion(dailySummaryDownload.body.pipe(file))

    // debug("download complete")
}


// console.log('hi');
// console.log('username: ' + process.env.LOGI_EMAIL);

run()