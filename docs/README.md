# Autorender
![Build app](https://github.com/kc1r74p/autorender/workflows/Build%20app/badge.svg)
[![Docker](https://github.com/kc1r74p/autorender/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/kc1r74p/autorender/actions/workflows/docker-publish.yml)
![1](https://img.shields.io/github/languages/code-size/kc1r74p/autorender)


https://user-images.githubusercontent.com/7422353/119197643-5dfb4900-ba88-11eb-9579-da7cfbaeda07.mp4


1. Takes gopro hero *.mp4 parts
2. renders overlay metadata, which is taken from .mp4 stream (gps track, spd, time, lat, long, distance)
3. renders overlays over parts
4. concats all parts to one track as .mp4

#### Options/Features:
* Overlay frame rate can be changed - Default 2 FPS
* Lat/Long auto detect timezone for overlay
* Custom data can be rendered on a per frame basis
* utilizing nodejs-canvas and ffmpeg for most parts
* small codebase
* can be used in a CI/CD for auto ingressing of new files
* if required this app can also be put into a docker container for removing setup steps

#### How to build:
* `git clone https://github.com/kc1r74p/autorender.git`
* `npm i`
* `npm run build`

#### How to run:
* Create following folders: **in**, **out**, **final** in the dist folder after the build
* Copy your *.mp4* parts into the **in** directory
* Run `npm start` in the main app dir
* Logging will tell when it is done **(or when your CPU fan stops going haywire)**
* In the **final** directory you will find the result video
* The **out** dir is used as temp location for overlay and parts and should be cleaned after each run

#### Known issues:
* GPS Fix state not considered for track length or track rendering
* Each overlay frame gets rendered on the disk, this is required for ffmpeg but may be improved
* Concat and overlay apply can be proccessed by ffmpeg in one command to save render time instead of seperated runs
* Typings incomplete
* Where are the tests at ?
* Clunky logging, file path construction, ...

#### Credits/Mentions:
* gopro-telemetry which allows extraction of gopro data from video https://github.com/JuanIrache/gopro-telemetry
* ffmpeg packages which make it possible to do all required rendering work right out of nodejs
* canvas via nodejs which makes rendering an easy task while staying on server side

