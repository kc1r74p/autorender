import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { createCanvas } from 'canvas';
import ffprobe from 'ffprobe-client';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import goproTelemetry from 'gopro-telemetry';
import moment from 'moment-timezone';
import * as path from 'path';
import tzlookup from 'tz-lookup';
import * as util from 'util';

// setup env
process.env.FFPROBE_PATH = ffprobeInstaller.path;
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const overlayFPS = 2;
const globalTZ = 'Europe/Berlin';

const extractGPMF = async (videoFile: any) => {
    const ffData = await ffprobe(videoFile);
    for (let i = 0; i < ffData.streams.length; i++) {
        if (ffData.streams[i].codec_tag_string === 'gpmd') {
            return [await extractGPMFAt(videoFile, i), ffData];
        }
    }
    console.error('[Invalid file] No data stream (gpmd) found in: ' + videoFile);
    return [null, null];
};

const extractGPMFAt = async (videoFile: any, stream: number) => {
    let rawData = Buffer.alloc(0);
    await new Promise((resolve) => {
        ffmpeg(videoFile)
            .outputOption('-y')
            .outputOptions('-codec copy')
            .outputOptions(`-map 0:${stream}`)
            .outputOption('-f rawvideo')
            .pipe()
            .on('data', (chunk) => {
                rawData = Buffer.concat([rawData, chunk]);
            })
            .on('end', async () => { await sleep(100); return resolve({}) });
    });
    return rawData;
};

function getSamplefromTime(time: moment.Moment, samples: any[]) {
    const searchFor = time.valueOf();
    const closest = samples.reduce((prev, curr) => {
        if (!curr || !curr.date) { return; }
        if (!prev) { return curr; }
        return (Math.abs(moment(curr.date).valueOf() - searchFor)
            < Math.abs(moment(prev.date).valueOf() - searchFor)
            ? curr : prev);
    });
    return closest;
}

let lastValidBound: any = null;
function getBoundingRect(data: any) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;

    for (let { value } of data) {
        if (value) { lastValidBound = value; }
        if (!value) { value = lastValidBound; }
        const [lat, long, hgt, spd, inc] = value;
        if (left > long) { left = long; }
        if (top > lat) { top = lat; }
        if (right < long) { right = long; }
        if (bottom < lat) { bottom = lat; }
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

let lastValidRoute: any = null;
function drawRoute(x: number, y: number, w: number, h: number, ctx: any, data: any) {
    const boundingRect = getBoundingRect(data);
    for (let { value } of data) {
        if (value) { lastValidRoute = value; }
        if (!value) { value = lastValidRoute; }
        const [lat, long, hgt, spd, inc] = value;
        let xx = (long - boundingRect.x) / boundingRect.width * w;
        let yy = (lat - boundingRect.y) / boundingRect.height * h;
        yy *= -1;
        yy += h;
        xx += x;
        yy += y;
        ctx.fillRect(xx, yy, 1, 1);
    }
}

function drawRoutePosition(x: number, y: number, w: number, h: number, ctx: any, data: any, lat: number, long: number) {
    const boundingRect = getBoundingRect(data);
    let xx = (long - boundingRect.x) / boundingRect.width * w;
    let yy = (lat - boundingRect.y) / boundingRect.height * h;
    yy *= -1;
    yy += h;

    xx += x;
    yy += y;

    // track crosshair
    ctx.fillRect(xx, y + 0, 1, h);
    ctx.fillRect(x + 0, yy, w, 1);
}

// SRC: https://www.geodatasource.com/developers/javascript
function distance(lat1: number, lon1: number, lat2: number, lon2: number, unit: string) {
    if ((lat1 === lat2) && (lon1 === lon2)) {
        return 0;
    } else {
        const radlat1 = Math.PI * lat1 / 180;
        const radlat2 = Math.PI * lat2 / 180;
        const theta = lon1 - lon2;
        const radtheta = Math.PI * theta / 180;
        let dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180 / Math.PI;
        dist = dist * 60 * 1.1515;
        if (unit === 'K') { dist = dist * 1.609344; }
        if (unit === 'N') { dist = dist * 0.8684; }
        return dist;
    }
}

function roundRect(ctx: any, x: any, y: any, width: any, height: any, radius: any, fill: boolean, stroke: boolean) {
    if (typeof stroke === 'undefined') {
        stroke = true;
    }
    if (typeof radius === 'undefined') {
        radius = 5;
    }
    if (typeof radius === 'number') {
        radius = { tl: radius, tr: radius, br: radius, bl: radius };
    } else {
        const defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
        for (const side in defaultRadius) {
            if (side in radius) {
                radius[side] = radius[side];
            }
        }
    }
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) {
        ctx.fill();
    }
    if (stroke) {
        ctx.stroke();
    }
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function getCompleteTrack(inDir: string, files: any[]) {
    const track = await files.reduce(async (prevTrack, f) => {
        const ctrack = await prevTrack;
        const [raw, ffData]: any = await extractGPMF(inDir + f);
        if (!raw) { return ctrack; }
        const data = await goproTelemetry({ rawData: raw });
        const key = Object.keys(data).filter((x) => data[x].streams && data[x].streams.GPS5)[0];
        ctrack.push(...data[key].streams.GPS5.samples);
        return ctrack;
    }, Promise.resolve([]));
    return track;
}

async function getStartDate(inDir: string, files: any[]) {
    const min = await files.reduce(async (minP, f) => {
        const cmin = await minP;
        const [raw, ffData]: any = await extractGPMF(inDir + f);
        if (!ffData) { return cmin; }
        return moment.min([cmin, moment.utc(ffData.format.tags.creation_time)]);
    }, Promise.resolve(moment.utc()));
    return min;
}

function getTrackLen(track: any[], until?: any) {
    // calc dist total
    let lastValid: any = null;
    const trackLength = track.slice(0).reduce((len, pnt, idx, arr) => {
        if (idx < 1) { return 0; }
        if (lastValid && pnt?.value) { lastValid = pnt; }
        if (!pnt?.value) { pnt = lastValid; }
        let prevPnt = arr[idx - 1];
        if (!prevPnt?.value) { prevPnt = lastValid; }
        if (!pnt || !prevPnt) { return len; }
        const [lat1, long1, hgt1, spd1, inc1] = prevPnt.value;
        const [lat2, long2, hgt2, spd2, inc2] = pnt.value;
        const ll = len + distance(lat1, long1, lat2, long2, 'K');
        // early exit
        if (until) {
            const [lat3, long3, hgt3, spd3, inc3] = until.value;
            if (lat1 === lat3 && long1 === long3) {
                arr.splice(1);
            }
        }
        return ll;
    }, track.slice(-1)[0]);
    return trackLength;
}

async function renderFullTrack(ctx: any, x: number, y: number, w: number, h: number, fullTrack: any) {
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    // ctx.font = '10px Arial';

    ctx.fillStyle = 'rgba(80,80,80,0.5)';
    roundRect(ctx, x, y, w, h, 10, true, false);
    ctx.fillStyle = 'white';

    ctx.lineWidth = 1;
    drawRoute(x + 5, y + 5, w - 10, h - 10, ctx, fullTrack);
}

async function handleVideo(file: string, fullTrack: any) {
    const rawName = path.basename(file);
    const [raw, ffData]: any = await extractGPMF(file);
    if (!raw) { return; }
    const vid = ffData.streams.filter((s: any) => s.codec_type === 'video')[0];
    console.log('File: ' + rawName);
    console.log('Size: ' + Math.round(ffData.format.size / 1024 / 1024) + 'MiB');
    console.log('Created: ' + ffData.format.tags.creation_time);
    console.log('Length: ' + Math.trunc(ffData.format.duration / 60) + 'min ' +
        Math.trunc(ffData.format.duration % 60) + 's');
    console.log('Res: ' + vid.width + 'x' + vid.height + ' @ ' + vid.r_frame_rate);
    console.log('---------------------');
    console.log('Render targets:');
    const frames = Math.trunc(ffData.format.duration * 60);
    console.log('Total Frames: ' + frames);
    console.log('Res: ' + vid.width + 'x' + vid.height + ' @ 60');
    console.log('---------------------');

    const data = await goproTelemetry({ rawData: raw });
    const key = Object.keys(data).filter((x) => data[x].streams && data[x].streams.GPS5)[0];
    const zeroMark = moment(data[key].streams.GPS5.samples.slice(0, 1)[0].date);
    const renderList: any[] = [];

    // SAMPLE FETCH LOOP
    for (let i = 0; i < frames; i++) {
        if (i % Math.round(60 / overlayFPS) !== 0) { continue; }
        const timeMS = (1000 / 60 * i);
        const timeTotal = moment(zeroMark).add(timeMS, 'milliseconds');
        const sample = getSamplefromTime(timeTotal, data[key].streams.GPS5.samples);
        if (!sample) { continue; }
        if (i % Math.trunc(frames / 100) === 0) {
            console.log(rawName + ': [' + Math.round(i / frames * 100) + '%] TrgTime: ' + timeTotal.toISOString());
        }
        renderList.push(sample);
    }

    console.log('Collected target frames: ' + renderList.length);
    console.log('Beginning frame rendering...');

    // uhh
    if (!fs.existsSync(__dirname + '/out/' + rawName)) {
        fs.mkdirSync(__dirname + '/out/' + rawName);
    }

    // RENDER LOOP
    for (let i = 0; i < renderList.length; i++) {
        const trackInfo = renderList[i];
        await renderSample(i, trackInfo, vid, rawName, fullTrack);
        if ((i / renderList.length * 100) % 10 === 0) {
            console.log(rawName + ': Frame render [' + Math.round(i / renderList.length * 100) + '%]');
        }
    }

    console.log('Rendered overlay frames for file: ' + rawName);
}

function pad(num: number, size: number) {
    let s = num + '';
    while (s.length < size) { s = '0' + s; }
    return s;
}

async function renderSample(frame: number, sample: any, video: any, rawName: string, fullTrack: any[]) {
    const [lat, long, hgt, spd, inc] = sample.value;
    const spdKMH = (spd * 3.6).toFixed(2) + ' km/h';
    let dist = fullTrack ? getTrackLen(fullTrack, sample) : 0;
    dist = dist.toFixed(3) + 'km';

    const date = moment.utc(sample.date).tz(tzlookup(lat, long) || globalTZ).format('YYYY-MM-DD HH:mm:ss');

    const canvas = createCanvas(video.width, video.height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;

    // TODO: scale all by res / settings
    ctx.font = '30px Arial';

    // date time
    ctx.fillText(date, 50, 100);
    ctx.strokeText(date, 50, 100);

    // lat long
    ctx.fillText(lat, 50, video.height - 100);
    ctx.strokeText(lat, 50, video.height - 100);
    ctx.fillText(long, 240, video.height - 100);
    ctx.strokeText(long, 240, video.height - 100);

    // spd
    ctx.fillText(spdKMH, 50, video.height - 150);
    ctx.strokeText(spdKMH, 50, video.height - 150);

    // track len
    ctx.fillText(dist, 50, video.height - 50);
    ctx.strokeText(dist, 50, video.height - 50);

    // minimap - has more or less scaling
    const { x, y, w, h } = {
        h: (video.width * 0.15) / 2,
        w: (video.width * 0.15),
        x: video.width - (video.width * 0.15) - 20,
        y: video.height - (video.width * 0.15) + (video.width * 0.15) / 2 - 20,
    };

    if (fullTrack) {
        renderFullTrack(ctx, x, y, w, h, fullTrack);
        drawRoutePosition(x + 5, y + 5, w - 10, h - 10, ctx, fullTrack, lat, long);
    }

    async function renderFrameFile(stream: any, iCanvas: any) {
        return new Promise((resolve) => {
            iCanvas.createPNGStream().pipe(stream);
            stream.on('finish', resolve);
        });
    }

    const out = fs.createWriteStream(__dirname + '/out/' + rawName + '/' + pad(frame, 4) + '.png');
    await renderFrameFile(out, canvas);
}

async function asyncForEach(array: any, callback: any) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

async function renderOverlayedPart(inDir: string, outDir: string, file: string) {
    return new Promise(async (resolve, reject) => {
        const [raw, ffData]: any = await extractGPMF(inDir + file);
        const formattedLength = moment.utc(ffData.format.duration*1000);

        let nextStartTime = Date.now();
        let avgTime : number = 1;

        // for testing add .addOption('-t 5') which will return a 5s video instead of whole duration
        const render = ffmpeg(inDir + file)
            .addInput(outDir + file + '/%04d.png')
            .inputFPS(overlayFPS)
            .complexFilter([
                {
                    filter: 'overlay',
                    input: '[0:v][1:v]',
                },
            ] as any)
            .addOption('-c:a copy')
            .on('end', resolve)
            .on('error', reject)
            .on('progress', (progress: { timemark: moment.MomentInput; }) => {
                const prog = moment(progress.timemark, 'HH:mm:ss.SS');
                const currentProg = prog.diff(moment().startOf('day'), 'seconds');
                const percentage = currentProg / ffData.format.duration;

                if (Math.round(percentage) % 1 === 0) {
                    const deltaTime = Number(Date.now()) - nextStartTime;
                    avgTime = deltaTime + avgTime / 2;
                    nextStartTime = Date.now();
                }
                if (Math.round(prog.valueOf() / 100) % 10 === 0) {
                    const eta = ((ffData.format.duration - currentProg) * avgTime) / 1000 / 60;
                    console.log(file + '] Processing: ' + prog.format("HH:mm:ss") + '/' + formattedLength.format("HH:mm:ss") + ' - ETA: ' + eta.toFixed(2) + ' min (' + (percentage * 100).toFixed(0) + '%)');
                }
            }) 
            //.withVideoCodec('h264_nvenc') // <- needs more settings for quality, at least will use GPU
            .output(outDir + 'rendered_' + file)
        render.run();
    });
}

async function concatVideos(inDir: string, outDir: string, files: string[], date: moment.Moment) {
    if (files.length < 1) { return; }
    return new Promise((resolve, reject) => {
        const render = ffmpeg(inDir + files[0]);
        files.shift();
        files.forEach((f) => render.addInput(inDir + f));
        render.addOption('-safe 0')
            // .withVideoCodec('h264_nvenc') // <- needs more settings for quality, at least will use GPU
            .on('end', resolve)
            .on('error', reject)
            .on('progress', (progress) => {
                const tm = moment(progress.timemark, 'HH:mm:ss.SS').valueOf();
                if (Math.round(tm / 100) % 10 === 0) {
                    console.log('Concat processing: ' + progress.timemark);
                }
            });

        render.mergeToFile(outDir + date.format('YYYYMMDD_HHmmss') + '.mp4', __dirname + '/out/');
    });
}

async function load() {
    const startTime = moment();
    console.log('START Current time: ' + startTime.toISOString());

    const inDir = __dirname + '/in/';
    const outDir = __dirname + '/out/';
    const renderOutDir = __dirname + '/final/';
    const readdir = util.promisify(fs.readdir) as any;
    console.log('inDir: ' + inDir);

    await readdir(inDir, async (err: any, files: any[]) => {
        console.log('All files: ' + files.join(','));
        let fileArr = files.filter((x) => x.toLowerCase().includes('.mp4'));

        if(fileArr.length < 1){
            console.error('Error: No *.mp4 files found in ' + inDir);
            process.exit(1);
        }

        console.log('Files for one track: ' + fileArr.join(','));

        // collect track metadata over all files
        const [cTrack, startDate] = await Promise.all([
            await getCompleteTrack(inDir, fileArr),
            await getStartDate(inDir, fileArr)
        ]);

        const tl = getTrackLen(cTrack);
        console.log('Track length: ' + tl.toFixed(3) + 'km');
        console.log('Track start: ' + startDate.toISOString());
        console.log('----------------------------');

        const videoHandlers: [Promise<void>] = [Promise.resolve()];
        await asyncForEach(fileArr, async (file: string) => {
            videoHandlers.push(handleVideo(inDir + file, cTrack));
        });

        // render overlay images in parallel
        await Promise.all(videoHandlers);

        console.log('----------------------------');
        console.log('Overlay frames done');
        console.log('Proceeding with overlaying over raws');

        await asyncForEach(fileArr, async (file: string) => {
            console.log('Starting: ' + file);
            await renderOverlayedPart(inDir, outDir, file);
            console.log('Done: ' + file);
            console.log('----------------------------');
        });

        // build out files from above, TODO: return out files above instead of this "logic"
        fileArr = fileArr.map((x) => {
            x = 'rendered_' + x;
            return x;
        });

        // render final file by concatinating all rendered parts of track
        if (fileArr.length > 1) {
            await concatVideos(outDir, renderOutDir, fileArr, startDate);
        } else {
            fs.copyFileSync(outDir + fileArr[0], renderOutDir + startDate.format('YYYYMMDD_HHmmss') + '.mp4');
        }

        console.log('END: ' + moment().toISOString());
        const duration = moment.utc(moment().diff(moment(startTime, 'HH:mm:ss'))).format('HH:mm:ss');
        console.log('Duration: ' + duration);
    });

}

load();
