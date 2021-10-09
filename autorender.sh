#!/bin/bash

export NODE_OPTIONS="--max-old-space-size=8192"
node --trace-warnings autorender/dist/index.js
