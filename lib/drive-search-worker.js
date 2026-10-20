'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const { searchDriveRoot } = require('./search')

const { drive, markerBasename, maxDepth } = workerData
parentPort.postMessage(searchDriveRoot(drive, markerBasename, maxDepth))
