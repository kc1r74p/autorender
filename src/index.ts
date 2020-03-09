// tslint:disable: no-var-requires
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
import { createCanvas } from 'canvas';
const ffprobe = require('ffprobe-client');
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
const goproTelemetry = require('gopro-telemetry');
import moment from 'moment';
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
    return null;
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
            }).on('end', resolve);
    });
    return rawData;
};

function getSamplefromTime(time: moment.Moment, samples: any[]) {
    const searchFor = time.valueOf();
    // console.log("search: " + searchFor);
    const closest = samples.reduce((prev, curr) => {
        if (!curr || !curr.date) { return; }
        if (!prev) { return curr; }
        //   console.log("curr: " + moment(curr.date).valueOf());
        //  console.log("prev: " + moment(prev.date).valueOf());
        return (Math.abs(moment(curr.date).valueOf() - searchFor)
            < Math.abs(moment(prev.date).valueOf() - searchFor)
            ? curr : prev);
    });
    return closest;
}

function getBoundingRect(data: any) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;

    for (const { value } of data) {
        const [lat, long, hgt, spd, inc] = value;
        if (left > long) { left = long; }
        if (top > lat) { top = lat; }
        if (right < long) { right = long; }
        if (bottom < lat) { bottom = lat; }
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function drawRoute(x: number, y: number, w: number, h: number, ctx: any, data: any) {
    const boundingRect = getBoundingRect(data);
    for (const { value } of data) {
        const [lat, long, hgt, spd, inc] = value;
        let xx = (long - boundingRect.x) / boundingRect.width * w;
        let yy = (lat - boundingRect.y) / boundingRect.height * h;
        yy *= -1;
        yy += h;

        xx += x;
        yy += y;
        ctx.fillRect(xx, yy, 1, 1);

        /*
        if (value === data[0].value) {
            ctx.fillText("Start", xx - 1, yy - 1);
        }
        if (value === data.slice(-1)[0].value) {
            ctx.fillText("End", xx - 1, yy - 1);
        }*/
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

    // rect
    // ctx.fillRect(xx-2, yy-2, 4, 4);

    // dot
    // ctx.beginPath();
    // ctx.arc(xx, yy, 3, 0, 2 * Math.PI);
    // ctx.fill();

    // track crosshair
    ctx.fillRect(xx, y + 0, 1, h);
    ctx.fillRect(x + 0, yy, w, 1);
}

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

async function getCompleteTrack(inDir: string, files: any[]) {
    const track = await files.reduce(async (prevTrack, f) => {
        const ctrack = await prevTrack;
        const [raw, ffData]: any = await extractGPMF(inDir + f);
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
        return moment.min([cmin, moment.utc(ffData.format.tags.creation_time)]);
    }, Promise.resolve(moment.utc()));
    return min;
}

async function getTrackLen(track: any[], until?: any) {
    // calc dist total
    const trackLength = track.slice(0).reduce((len, pnt, idx, arr) => {
        if (idx < 1) { return 0; }
        const prevPnt = arr[idx - 1];
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
    // console.log("Collected track: " + trackLength.toFixed(2) + "km");
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
    const vid = ffData.streams.filter((s: any) => s.codec_type === 'video')[0];
    // tslint:disable: no-console
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

    const data = goproTelemetry({ rawData: raw });
    const key = Object.keys(data).filter((x) => data[x].streams && data[x].streams.GPS5)[0];
    const zeroMark = moment(data[key].streams.GPS5.samples.slice(0, 1)[0].date);
    const renderList = [];

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
        // console.log(Math.round(i / frames * 100) + "%] Fr: " + i + " MS: " + Math.round(timeMS) +
        // " TrgTime: " + timeTotal.toISOString() + " found match at: " + moment(sample.date).toISOString());

        // 2frame per sec for now .... to be fixed to have dynamic frames ...
        // if (i % Math.round(60 / overlayFPS) === 0) {
        renderList.push(sample);
        //  }
    }

    console.log('Collected target frames: ' + renderList.length);
    console.log('Beginning frame rendering...');

    if (!fs.existsSync(__dirname + '/out/' + rawName)) {
        fs.mkdirSync(__dirname + '/out/' + rawName);
    }

    // RENDER LOOP - current setup 1 frame per 1 sec -> static FPS
    for (let i = 0; i < renderList.length; i++) {
        const s = renderList[i];
        await renderSample(i, s, vid, rawName, fullTrack);
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
    let dist = await getTrackLen(fullTrack, sample);
    dist = dist.toFixed(3) + 'km';

    const date = moment.utc(sample.date).tz(tzlookup(lat, long) || globalTZ).format('YYYY-MM-DD HH:mm:ss');

    const canvas = createCanvas(video.width, video.height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.font = '30px Arial';

    // date time
    ctx.fillText(date, 50, 100);
    ctx.strokeText(date, 50, 100);

    // lat long
    ctx.fillText(lat, 50, video.height - 100);
    ctx.strokeText(lat, 50, video.height - 100);
    ctx.fillText(long, 230, video.height - 100);
    ctx.strokeText(long, 230, video.height - 100);

    // spd
    ctx.fillText(spdKMH, 50, video.height - 150);
    ctx.strokeText(spdKMH, 50, video.height - 150);

    // track len
    ctx.fillText(dist, 50, video.height - 50);
    ctx.strokeText(dist, 50, video.height - 50);

    // minimap
    const { x, y, w, h } = {
        h: (video.width * 0.15) / 2,
        w: (video.width * 0.15),
        x: video.width - (video.width * 0.15) - 20,
        y: video.height - (video.width * 0.15) + (video.width * 0.15) / 2 - 20,
    };

    renderFullTrack(ctx, x, y, w, h, fullTrack);
    drawRoutePosition(x + 5, y + 5, w - 10, h - 10, ctx, fullTrack, lat, long);

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
    return new Promise((resolve, reject) => {
        const render = ffmpeg(inDir + file)
            .addInput(outDir + file + '/%04d.png')
            .inputFPS(overlayFPS)
            .complexFilter([
                {
                    filter: 'overlay',
                    input: '[0:v][1:v]',
                },
            ] as any)
            .addOption('-pix_fmt yuv420p')
            .addOption('-c:a copy')
            .on('end', resolve)
            .on('error', reject)
            .on('progress', (progress: { timemark: moment.MomentInput; }) => {
                const tm = moment(progress.timemark, 'HH:mm:ss.SS').valueOf();
                if (tm % 1000 === 0) {
                    console.log(file + '] Processing: ' + progress.timemark);
                }
            })
            .output(outDir + 'rendered_' + file);

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
            .on('end', resolve)
            .on('error', reject)
            .on('progress', (progress) => {
                const tm = moment(progress.timemark, 'HH:mm:ss.SS').valueOf();
                if (tm % 1000 === 0) {
                    console.log('Concat processing: ' + progress.timemark);
                }
            });

        render.mergeToFile(outDir + date.format('YYYYMMDD_HHmmss') + '.mp4');
    });
}

async function load() {
    const startTime = moment();
    console.log('START: ' + startTime.toISOString());

    const inDir = __dirname + '/in/';
    const outDir = __dirname + '/out/';
    const renderOutDir = __dirname + '/final/';
    const readdir = util.promisify(fs.readdir) as any;
    console.log('inDir: ' + inDir);

    await readdir(inDir, async (err: any, files: any[]) => {
        console.log('All files: ' + files.join(','));
        let fileArr = files.filter((x) => x.toLowerCase().includes('.mp4'));
        console.log('Files for one track: ' + fileArr.join(','));

        const trk = await getCompleteTrack(inDir, fileArr);
        const tl = await getTrackLen(trk);
        console.log('Track length: ' + tl.toFixed(3) + 'km');

        const start = await getStartDate(inDir, files);
        console.log('Track start: ' + start.toISOString());

        await asyncForEach(fileArr, async (file: string) => {
            await handleVideo(inDir + file, trk);
        });

        console.log('Overlay frames done');
        console.log('Proceeding with overlaying');

        await asyncForEach(fileArr, async (file: string) => {
            console.log('Starting: ' + file);
            await renderOverlayedPart(inDir, outDir, file);
            console.log('Done: ' + file);
        });

        fileArr = fileArr.map((x) => {
            x = 'rendered_' + x;
            return x;
        });

        await concatVideos(outDir, renderOutDir, fileArr, start);

        console.log('END: ' + moment().toISOString());
        const duration = moment.utc(moment().diff(moment(startTime, 'HH:mm:ss'))).format('HH:mm:ss');
        console.log('Duration: ' + duration);
    });

}

load();
