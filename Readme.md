# LogiCircleDownloader

Usage: Tired of using circle.logi.com to see your clips? Want to keep a local archive, but don't want to pay for a cloud storage subscription? Call this script to download your "day brief" video from the command line.  
Installation:

1. Create a "downloads" subdirectory to hold the downloaded videos
2. `npm install`
1. Create `start.sh`, using `start.example.sh` as a template
3. `chmod +x start.sh`
4. `./start`

Caveats:

* Looks like it has to be run twice. Generating the video must take longer than 30 seconds?
* Puppeteer can't seem to launch Chrome headless out-of-the-box on raspberry pi zero w. Hmm.