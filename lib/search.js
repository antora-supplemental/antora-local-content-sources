'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_MAX_DEPTH = 10
const MARKER_FILENAME = '.antora-source-id'
const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'build',
  '$RECYCLE.BIN',
  'System Volume Information',
  'AppData',
  'Application Data',
  'Program Files',
  'Program Files (x86)',
  'Windows',
  '.npm',
  '.pnpm',
  '.cursor',
  'Cache',
  'Caches',
])
const DEFAULT_MAX_UPWARD_HOPS = 16

/**
 * @param {string} startDir
 * @returns {string | null} e.g. `C:\`
 */
function driveRootForPath (startDir) {
  const resolved = path.resolve(startDir)
  if (process.platform === 'win32') {
    const m = /^([a-zA-Z]:)[\\/]/.exec(resolved)
    if (m) return m[1] + path.sep
    return null
  }
  return path.parse(resolved).root || '/'
}

/**
 * @returns {string[]}
 */
function listOtherDriveRoots (startDir) {
  const startDrive = driveRootForPath(startDir)
  if (process.platform === 'win32') {
    const roots = []
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code)
      const root = `${letter}:${path.sep}`
      if (startDrive && root.toLowerCase() === startDrive.toLowerCase()) continue
      try {
        if (fs.existsSync(root)) roots.push(root)
      } catch {
        /* ignore */
      }
    }
    return roots
  }
  const extra = []
  for (const mountRoot of ['/Volumes', '/mnt']) {
    try {
      if (!fs.existsSync(mountRoot)) continue
      for (const ent of fs.readdirSync(mountRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        extra.push(path.join(mountRoot, ent.name))
      }
    } catch {
      /* ignore */
    }
  }
  const sysRoot = path.parse(path.resolve(startDir)).root || '/'
  return extra.filter((p) => path.resolve(p) !== path.resolve(sysRoot))
}

/**
 * Collect every marker file path under `dir` up to `maxDepth`, skipping `excludeSubdir` when walking `dir`.
 * @param {string} dir
 * @param {string} markerBasename
 * @param {number} depth
 * @param {string | null} excludeSubdir absolute path of child tree already searched
 * @param {string[]} out file paths
 */
function walkCollectMarkerFiles (dir, markerBasename, depth, excludeSubdir, out) {
  if (depth < 0) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (!ent.isDirectory()) {
      if (ent.name === markerBasename || ent.name === MARKER_FILENAME) out.push(full)
      continue
    }
    if (SKIP_DIR_NAMES.has(ent.name)) continue
    if (excludeSubdir && path.resolve(full) === path.resolve(excludeSubdir)) continue
    walkCollectMarkerFiles(full, markerBasename, depth - 1, null, out)
  }
}

/**
 * @param {string} startDir
 * @param {string} markerBasename
 * @param {number} maxDepth
 * @returns {string[]} unique clone roots (dirname of marker), nearest-upward first
 */
function searchUpwardFrom (startDir, markerBasename, maxDepth = DEFAULT_MAX_DEPTH, maxUpwardHops = DEFAULT_MAX_UPWARD_HOPS) {
  /** @type {string[]} */
  const orderedRoots = []
  const seen = new Set()
  const addRoot = (markerPath) => {
    const root = path.dirname(markerPath)
    const key = path.resolve(root)
    if (seen.has(key)) return
    seen.add(key)
    orderedRoots.push(root)
  }

  let dir = path.resolve(startDir)
  let excludeChild = null
  for (let hop = 0; hop <= maxUpwardHops; hop++) {
    const hits = []
    walkCollectMarkerFiles(dir, markerBasename, maxDepth, excludeChild, hits)
    for (const hit of hits) addRoot(hit)
    if (hop === maxUpwardHops) break
    excludeChild = dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return orderedRoots
}

/**
 * @param {string} driveRoot
 * @param {string} markerBasename
 * @param {number} maxDepth
 * @returns {string[]}
 */
function searchDriveRoot (driveRoot, markerBasename, maxDepth) {
  const hits = []
  walkCollectMarkerFiles(driveRoot, markerBasename, maxDepth, null, hits)
  const roots = []
  const seen = new Set()
  for (const hit of hits) {
    const root = path.resolve(path.dirname(hit))
    if (seen.has(root)) continue
    seen.add(root)
    roots.push(root)
  }
  return roots
}

/**
 * @param {string[]} driveRoots
 * @param {string} markerBasename
 * @param {number} maxDepth
 * @returns {Promise<string[]>}
 */
function searchDriveRootsParallel (driveRoots, markerBasename, maxDepth) {
  if (!driveRoots.length) return Promise.resolve([])
  if (driveRoots.length === 1) {
    return Promise.resolve(searchDriveRoot(driveRoots[0], markerBasename, maxDepth))
  }
  const workerPath = path.join(__dirname, 'drive-search-worker.js')
  return Promise.all(
    driveRoots.map(
      (drive) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(workerPath, {
            workerData: { drive, markerBasename, maxDepth },
          })
          worker.on('message', resolve)
          worker.on('error', reject)
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`drive search worker exited ${code}`))
          })
        })
    )
  ).then((chunks) => chunks.flat())
}

/**
 * Ordered search: upward from startDir, then extra roots, then other drives (parallel).
 * @param {object} opts
 * @param {string} opts.startDir
 * @param {string} opts.markerBasename
 * @param {number} [opts.maxDepth]
 * @param {string[]} [opts.extraRoots]
 * @param {boolean} [opts.searchOtherDrives]
 * @returns {Promise<string[]>}
 */
async function collectMarkerCloneRoots (opts) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  const markerBasename = opts.markerBasename
  const startDir = path.resolve(opts.startDir || process.cwd())
  const searchOtherDrives =
    opts.searchOtherDrives !== false &&
    process.env.ANTORA_LOCAL_SOURCES_SEARCH_DRIVES !== '0'

  /** @type {string[]} */
  const ordered = []
  const seen = new Set()
  const pushUnique = (roots) => {
    for (const root of roots) {
      const key = path.resolve(root)
      if (seen.has(key)) continue
      seen.add(key)
      ordered.push(root)
    }
  }

  pushUnique(searchUpwardFrom(startDir, markerBasename, maxDepth, opts.maxUpwardHops))

  for (const root of opts.extraRoots || []) {
    if (!root) continue
    const abs = path.resolve(root)
    if (!fs.existsSync(abs)) continue
    const hits = []
    walkCollectMarkerFiles(abs, markerBasename, maxDepth, null, hits)
    pushUnique(hits.map((h) => path.dirname(h)))
  }

  if (searchOtherDrives) {
    const drives = listOtherDriveRoots(startDir)
    const fromDrives = await searchDriveRootsParallel(drives, markerBasename, maxDepth)
    pushUnique(fromDrives)
  }

  return ordered
}

module.exports = {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_UPWARD_HOPS,
  MARKER_FILENAME,
  driveRootForPath,
  listOtherDriveRoots,
  searchUpwardFrom,
  searchDriveRoot,
  searchDriveRootsParallel,
  collectMarkerCloneRoots,
  walkCollectMarkerFiles,
}
