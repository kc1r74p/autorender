# Autorender

1. Takes gopro hero *.mp4 parts
2. renders overlay metadata, which is taken from .mp4 stream (gps track, spd, time, lat, long, distance)
3. renders overlays over parts
4. concats all parts to one track

#### Options/Features:
* Overlay frame rate can be changed - Default 2 FPS
* Custom data can be rendered on a per frame basis
* utilizing nodejs-canvas and ffmpeg for most parts
* small codebase
* can be used in a CI/CD for auto ingressing of new files

#### Known issues:
* As seen below gradient color overlay is applied for alpha area for the full height+width (to be investigated)
* Each overlay frame gets rendered on the disk, this is required for ffmpeg but may be improved
* Concat and overlay apply can be proccessed by ffmpeg in one command to save render time instead of seperated runs

#### Example:
###### Input frame
![Input frame](https://raw.githubusercontent.com/kc1r74p/autorender/master/docs/org.png "Input frame")

###### Output frame (Lat/Long removed)
![Result frame](https://raw.githubusercontent.com/kc1r74p/autorender/master/docs/overlay.png "Result frame")

#### Credits/Mentions
* gopro-telemetry which allows extraction of gopro data from video https://github.com/JuanIrache/gopro-telemetry
* ffmpeg packages which make it possible to do all required rendering work right out of nodejs
* canvas via nodejs which makes rendering an easy task while staying on server side

