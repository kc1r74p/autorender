const { createCanvas, loadImage } = require('canvas');
const moment = require('moment');
const goproTelemetry = require(`gopro-telemetry`);
const ffprobe = require('ffprobe-client');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require("path");
const util = require('util');

process.env.FFPROBE_PATH = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

const overlayFPS = 2;

const extractGPMF = async videoFile => {
    const ffData = await ffprobe(videoFile);
    for (let i = 0; i < ffData.streams.length; i++) {
        if (ffData.streams[i].codec_tag_string === 'gpmd') {
            return [await extractGPMFAt(videoFile, i), ffData];
        }
    }
    return null;
};

const extractGPMFAt = async (videoFile, stream) => {
    let rawData = Buffer.alloc(0);
    await new Promise(resolve => {
        ffmpeg(videoFile)
            .outputOption('-y')
            .outputOptions('-codec copy')
            .outputOptions(`-map 0:${stream}`)
            .outputOption('-f rawvideo')
            .pipe()
            .on('data', chunk => {
                rawData = Buffer.concat([rawData, chunk]);
            }).on('end', resolve);
    });
    return rawData;
};

function getSamplefromTime(time, samples) {
    const searchFor = time.valueOf();
    //console.log("search: " + searchFor);
    var closest = samples.reduce(function (prev, curr) {
        if (!curr || !curr.date) return;
        if (!prev) return curr;
        //   console.log("curr: " + moment(curr.date).valueOf());
        //  console.log("prev: " + moment(prev.date).valueOf());
        return (Math.abs(moment(curr.date).valueOf() - searchFor) < Math.abs(moment(prev.date).valueOf() - searchFor) ? curr : prev);
    });
    return closest;
}

function getBoundingRect(data) {
    let left = Infinity, right = -Infinity;
    let top = Infinity, bottom = -Infinity;

    for (let { value } of data) {
        const [lat, long, hgt, spd, inc] = value;
        if (left > long) left = long;
        if (top > lat) top = lat;
        if (right < long) right = long;
        if (bottom < lat) bottom = lat;
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function drawRoute(x, y, w, h, ctx, data) {
    let boundingRect = getBoundingRect(data);
    for (let { value } of data) {
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

function drawRoutePosition(x, y, w, h, ctx, data, lat, long) {
    let boundingRect = getBoundingRect(data);
    let xx = (long - boundingRect.x) / boundingRect.width * w;
    let yy = (lat - boundingRect.y) / boundingRect.height * h;
    yy *= -1;
    yy += h;

    xx += x;
    yy += y;

    //rect
    //ctx.fillRect(xx-2, yy-2, 4, 4);

    //dot
    //ctx.beginPath();
    //ctx.arc(xx, yy, 3, 0, 2 * Math.PI);
    //ctx.fill(); 

    //track crosshair
    ctx.fillRect(xx, y + 0, 1, h);
    ctx.fillRect(x + 0, yy, w, 1);
}

function distance(lat1, lon1, lat2, lon2, unit) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
        return 0;
    }
    else {
        var radlat1 = Math.PI * lat1 / 180;
        var radlat2 = Math.PI * lat2 / 180;
        var theta = lon1 - lon2;
        var radtheta = Math.PI * theta / 180;
        var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180 / Math.PI;
        dist = dist * 60 * 1.1515;
        if (unit == "K") { dist = dist * 1.609344 }
        if (unit == "N") { dist = dist * 0.8684 }
        return dist;
    }
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof stroke === 'undefined') {
        stroke = true;
    }
    if (typeof radius === 'undefined') {
        radius = 5;
    }
    if (typeof radius === 'number') {
        radius = { tl: radius, tr: radius, br: radius, bl: radius };
    } else {
        var defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
        for (var side in defaultRadius) {
            radius[side] = radius[side] || defaultRadius[side];
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

async function getCompleteTrack(inDir, files) {
    const track = await files.reduce(async (prevTrack, f) => {
        const track = await prevTrack;
        const [raw, ffData] = await extractGPMF(inDir + f);
        const data = await goproTelemetry({ rawData: raw });
        const key = Object.keys(data).filter((x) => data[x].streams && data[x].streams.GPS5)[0];
        track.push(...data[key].streams.GPS5.samples);
        return track;
    }, Promise.resolve([]));
    return track;
}

async function getStartDate(inDir, files) {
    const min = await files.reduce(async (minP, f) => {
        const min = await minP;
        const [raw, ffData] = await extractGPMF(inDir + f);
        return moment.min([min, moment(ffData.format.tags.creation_time)]);
    }, Promise.resolve(moment()));
    return min;
}

async function getTrackLen(track, until) {
    //calc dist total
    const trackLength = track.slice(0).reduce((len, pnt, idx, arr) => {
        if (idx < 1) return 0;
        const prevPnt = arr[idx - 1];
        const [lat1, long1, hgt1, spd1, inc1] = prevPnt.value;
        const [lat2, long2, hgt2, spd2, inc2] = pnt.value;
        const ll = len + distance(lat1, long1, lat2, long2, 'K');
        //early exit
        if (until) {
            const [lat3, long3, hgt3, spd3, inc3] = until.value;
            if (lat1 === lat3 && long1 === long3) {
                arr.splice(1);
            }
        }
        return ll;
    }, track.slice(-1)[0]);

    return trackLength;
    //console.log("Collected track: " + trackLength.toFixed(2) + "km");
}

async function renderFullTrack(ctx, x, y, w, h, fullTrack) {
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    //ctx.font = '10px Arial';

    ctx.fillStyle = 'rgba(80,80,80,0.5)';
    roundRect(ctx, x, y, w, h, 10, true);
    ctx.fillStyle = 'white';

    ctx.lineWidth = 1;
    drawRoute(x + 5, y + 5, w - 10, h - 10, ctx, fullTrack);
}

async function handleVideo(file, fullTrack) {
    const rawName = path.basename(file);
    const [raw, ffData] = await extractGPMF(file);
    const vid = ffData.streams.filter((s) => s.codec_type === 'video')[0];
    console.log("File: " + rawName);
    console.log("Size: " + Math.round(ffData.format.size / 1024 / 1024) + "MiB");
    console.log("Created: " + ffData.format.tags.creation_time);
    console.log("Length: " + Math.trunc(ffData.format.duration / 60) + "min " + Math.trunc(ffData.format.duration % 60) + "s");
    console.log("Res: " + vid.width + "x" + vid.height + " @ " + vid.r_frame_rate);
    console.log("---------------------");
    console.log("Render targets:");
    const frames = Math.trunc(ffData.format.duration * 60);
    console.log("Total Frames: " + frames);
    console.log("Res: " + vid.width + "x" + vid.height + " @ 60");
    console.log("---------------------");

    const data = goproTelemetry({ rawData: raw });
    const key = Object.keys(data).filter((x) => data[x].streams && data[x].streams.GPS5)[0];

    let zeroMark = 0;
    data[key].streams.GPS5.samples.slice(0, 1).forEach(s => {
        zeroMark = moment(s.date);
    });

    const renderList = [];

    // SAMPLE FETCH LOOP
    for (let i = 0; i < frames; i++) {

        if (i % Math.round(60 / overlayFPS) !== 0) continue;

        const timeMS = (1000 / 60 * i);
        const timeTotal = moment(zeroMark).add(timeMS, 'milliseconds');
        const sample = getSamplefromTime(timeTotal, data[key].streams.GPS5.samples);
        if (!sample) continue;
        if (i % Math.trunc(frames / 100) === 0)
            console.log(rawName + ": [" + Math.round(i / frames * 100) + "%] TrgTime: " + timeTotal.toISOString());
        //console.log(Math.round(i / frames * 100) + "%] Fr: " + i + " MS: " + Math.round(timeMS) + " TrgTime: " + timeTotal.toISOString() + " found match at: " + moment(sample.date).toISOString());

        //2frame per sec for now .... to be fixed to have dynamic frames ...
        // if (i % Math.round(60 / overlayFPS) === 0) {
        renderList.push(sample);
        //  }
    }

    console.log("Collected target frames: " + renderList.length);
    console.log("Beginning frame rendering...");

    if (!fs.existsSync(__dirname + '/out/' + rawName)) {
        fs.mkdirSync(__dirname + '/out/' + rawName);
    }

    // RENDER LOOP - current setup 1 frame per 1 sec -> static FPS
    for (let i = 0; i < renderList.length; i++) {
        const s = renderList[i];
        await renderSample(i, s, vid, rawName, fullTrack);
    }

    console.log("Rendered overlay frames for file: " + rawName);
}

function pad(num, size) {
    var s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
}

async function renderSample(frame, sample, video, rawName, fullTrack) {
    const date = moment(sample.date).format('YYYY-MM-DD HH:mm:ss');
    const [lat, long, hgt, spd, inc] = sample.value;
    const spdKMH = (spd * 3.6).toFixed(2) + " km/h";
    let dist = await getTrackLen(fullTrack, sample);
    dist = dist.toFixed(3) + "km";

    const canvas = createCanvas(video.width, video.height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.font = '30px Arial';

    //date time
    ctx.fillText(date, 50, 100);
    ctx.strokeText(date, 50, 100);

    // lat long
    ctx.fillText(lat, 50, video.height - 100);
    ctx.strokeText(lat, 50, video.height - 100);
    ctx.fillText(long, 230, video.height - 100);
    ctx.strokeText(long, 230, video.height - 100);

    //spd
    ctx.fillText(spdKMH, 50, video.height - 150);
    ctx.strokeText(spdKMH, 50, video.height - 150);

    // track len
    ctx.fillText(dist, 50, video.height - 50);
    ctx.strokeText(dist, 50, video.height - 50);

    //minimap
    const { x, y, w, h } = {
        x: video.width - (video.width * 0.15) - 20, y: video.height - (video.width * 0.15) + (video.width * 0.15) / 2 - 20,
        w: (video.width * 0.15), h: (video.width * 0.15) / 2
    };

    renderFullTrack(ctx, x, y, w, h, fullTrack);
    drawRoutePosition(x + 5, y + 5, w - 10, h - 10, ctx, fullTrack, lat, long);

    async function renderFrameFile(stream, canvas) {
        return new Promise(resolve => {
            canvas.createPNGStream().pipe(stream);
            stream.on('finish', resolve);
        });
    }

    const out = fs.createWriteStream(__dirname + '/out/' + rawName + '/' + pad(frame, 4) + '.png');
    await renderFrameFile(out, canvas);
}

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

async function load() {
    const startTime = moment();
    console.log("START: " + startTime.toISOString());

    const inDir = __dirname + '/in/';
    const outDir = __dirname + '/out/';
    const readdir = util.promisify(fs.readdir);
    //console.log("IN: " + inDir);
    await readdir(inDir, async function (err, files) {
        let fileArr = files.filter((x) => x.toLowerCase().includes('.mp4'));

        const trk = await getCompleteTrack(inDir, fileArr);
        const tl = await getTrackLen(trk);
        console.log("Track length: " + tl.toFixed(3) + "km");

        const start = await getStartDate(inDir, files);
        console.log("Track start: " + start.toISOString());

        await asyncForEach(fileArr, async function (file) {
            await handleVideo(inDir + file, trk);
        });

        console.log("Overlay frames done");
        console.log("Proceeding with overlaying");

        async function renderOverlayedPart(inDir, outDir, file) {
            return new Promise((resolve, reject) => {
                const render = ffmpeg(inDir + file)
                    .addInput(outDir + file + '/%04d.png')
                    .inputFPS(overlayFPS)
                    .complexFilter([
                        {
                            "filter": "overlay",
                            "input": "[0:v][1:v]"
                        }
                    ])
                    .addOption('-pix_fmt yuv420p')
                    .addOption('-c:a copy')
                    .on('end', resolve)
                    .on('error', reject)
                    .on('progress', function (progress) {
                        const tm = moment(progress.timemark, "HH:mm:ss.SS").valueOf();
                        if (tm % 1000 === 0)
                            console.log(file + '] Processing: ' + progress.timemark);
                    })
                    .output(outDir + 'rendered_' + file);

                render.run();
            });
        }

        async function concatVideos(inDir, outDir, files, date) {
            if (files.length < 1) return;
            return new Promise((resolve, reject) => {
                const render = ffmpeg(inDir + files[0]);
                files.shift();
                files.forEach(f => render.addInput(inDir + f))
                render.addOption('-safe 0')
                    .on('end', resolve)
                    .on('error', reject)
                    .on('progress', function (progress) {
                        const tm = moment(progress.timemark, "HH:mm:ss.SS").valueOf();
                        if (tm % 1000 === 0)
                            console.log('Concat processing: ' + progress.timemark);
                    });

                render.mergeToFile(outDir + date.format('YYYYMMDD_HHmmss') + ".mp4");
            });
        }


        await asyncForEach(fileArr, async function (file) {
            console.log("Starting: " + file);
            await renderOverlayedPart(inDir, outDir, file);
            console.log("Done: " + file);
        });

        fileArr = fileArr.map(x => {
            x = 'rendered_' + x;
            return x;
        });


        await concatVideos(outDir, outDir, fileArr, start);

        console.log("END: " + moment().toISOString());
        var duration = moment.utc(moment().diff(moment(startTime, "HH:mm:ss"))).format("HH:mm:ss");
        console.log("Duration: " + duration);
    });

}

load();
