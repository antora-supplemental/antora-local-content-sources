'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { markerIdForRemote, normalizeGitRemoteUrl, githubOwnerRepo, MARKER_BASENAME } = require('./marker-id')
const { markerContentMatchesRemote, MARKER_BASENAME: MARKER_FILE } = require('./marker-match')
const { collectMarkerCloneRoots, DEFAULT_MAX_DEPTH } = require('./search')
const { defaultOverridePaths, loadPathOverrides, pickOverridePath } = require('./overrides')

const MARKER_FILENAME = MARKER_BASENAME

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isGitCheckout (dir) {
  try {
    return fs.statSync(path.join(dir, '.git')).isDirectory()
  } catch {
    return fs.existsSync(path.join(dir, '.git'))
  }
}

/**
 * Hive-style fallback when marker files are not present yet.
 * @param {string[]} roots
 * @param {string} remoteUrl
 * @returns {string | null}
 */
function heuristicHivePath (roots, remoteUrl) {
  const gh = githubOwnerRepo(remoteUrl)
  if (!gh) return null
  const rel = path.join('github.com', gh.owner, gh.repo)
  for (const root of roots) {
    if (!root) continue
    const candidate = path.resolve(root, rel)
    if (fs.existsSync(candidate) && isGitCheckout(candidate)) return candidate
    const fork = path.resolve(root, 'github.com', gh.owner, '.forks', gh.repo)
    if (fs.existsSync(fork) && isGitCheckout(fork)) return fork
  }
  return null
}

/**
 * @param {object} cache
 * @param {string} markerId
 * @param {string} localRoot
 */
function cachePut (cache, markerId, localRoot) {
  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(path.join(localRoot, MARKER_FILE)).mtimeMs
  } catch {
    mtimeMs = Date.now()
  }
  cache.entries[markerId] = {
    path: localRoot,
    mtimeMs,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * @param {object} cache
 * @param {string} markerId
 * @param {string} normalizedRemote
 * @returns {string | null}
 */
function cacheGetValid (cache, markerId, normalizedRemote) {
  const row = cache.entries?.[markerId]
  if (!row?.path) return null
  const root = path.resolve(row.path)
  const markerPath = path.join(root, MARKER_FILE)
  if (!fs.existsSync(markerPath)) return null
  try {
    const mtimeMs = fs.statSync(markerPath).mtimeMs
    if (row.mtimeMs && mtimeMs !== row.mtimeMs) return null
  } catch {
    return null
  }
  if (!markerContentMatchesRemote(root, normalizedRemote, markerId)) return null
  return root
}

/**
 * @param {string} root
 * @param {string} markerId
 * @param {string} normalizedRemote
 * @returns {boolean}
 */
function rootHasMarker (root, markerId, normalizedRemote) {
  return markerContentMatchesRemote(root, normalizedRemote, markerId) && isGitCheckout(root)
}

/**
 * @param {string[]} matches
 * @param {string | null} overridePath
 * @param {string} markerId
 * @param {string} normalizedRemote
 * @returns {{ localRoot: string | null, method: string, overrideUsed: boolean }}
 */
function chooseLocalRoot (matches, overridePath, markerId, normalizedRemote) {
  if (overridePath) {
    const resolved = path.resolve(overridePath)
    if (rootHasMarker(resolved, markerId, normalizedRemote)) {
      const inList = matches.some((m) => path.resolve(m) === resolved)
      return {
        localRoot: resolved,
        method: inList ? 'override' : 'override-forced',
        overrideUsed: true,
      }
    }
  }
  if (matches.length) {
    return { localRoot: matches[0], method: matches.length > 1 ? 'first-match' : 'marker-search', overrideUsed: false }
  }
  return { localRoot: null, method: 'none', overrideUsed: false }
}

/**
 * @param {object} opts
 * @returns {Promise<{ resolved: object[], cache: object, report: object[] }>}
 */
async function resolveLocalSourcesAsync (opts) {
  const sources = opts.sources || []
  const startDir = path.resolve(opts.startDir || process.cwd())
  const searchRoots = [...new Set((opts.searchRoots || []).map((r) => path.resolve(r)))]
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxUpwardHops = opts.maxUpwardHops
  const overrides =
    opts.overrides && typeof opts.overrides === 'object'
      ? opts.overrides
      : loadPathOverrides(opts.overridePaths || [])

  let cache = { version: 2, entries: {} }
  if (opts.cachePath && fs.existsSync(opts.cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(opts.cachePath, 'utf8'))
      if (!cache.entries) cache.entries = {}
    } catch {
      cache = { version: 2, entries: {} }
    }
  }

  /** @type {Map<string, string>} normalized remote -> local root */
  const byRemote = new Map()
  const report = []

  for (const src of sources) {
    const url = String(src.url || '')
    if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) continue
    const normalized = normalizeGitRemoteUrl(url)
    if (byRemote.has(normalized)) continue

    const markerId = markerIdForRemote(url)
    let matches = []
    let localRoot = cacheGetValid(cache, markerId, normalized)
    let method = 'cache'
    let overrideUsed = false

    if (!localRoot) {
      matches = await collectMarkerCloneRoots({
        startDir,
        normalizedRemote: normalized,
        markerId,
        maxDepth,
        maxUpwardHops,
        extraRoots: searchRoots,
        searchOtherDrives: opts.searchOtherDrives,
        searchMethod: opts.searchMethod || 'auto',
      })
      if (!matches.length) {
        const hive = heuristicHivePath(searchRoots.length ? searchRoots : [startDir], url)
        if (hive) matches = [hive]
        if (hive) method = 'hive-heuristic'
      }

      const overridePath = pickOverridePath(overrides, normalized, markerId)
      const choice = chooseLocalRoot(matches, overridePath, markerId, normalized)
      localRoot = choice.localRoot
      method = choice.method === 'none' ? method : choice.method
      overrideUsed = choice.overrideUsed
    } else {
      matches = [localRoot]
    }

    const conflict = matches.length > 1 && !overrideUsed
    if (localRoot) {
      cachePut(cache, markerId, localRoot)
      byRemote.set(normalized, localRoot)
    }

    report.push({
      remote: normalized,
      markerId,
      markerFile: MARKER_FILE,
      localRoot: localRoot || null,
      method,
      matches: matches.map((m) => path.resolve(m)),
      conflict,
      overrideUsed,
    })
  }

  const resolved = sources.map((src) => {
    const url = String(src.url || '')
    if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) {
      return { ...src, _local: false }
    }
    const normalized = normalizeGitRemoteUrl(url)
    const localRoot = byRemote.get(normalized)
    if (!localRoot) return { ...src, _local: false, _remote: normalized }
    return {
      ...src,
      url: localRoot,
      worktrees: true,
      _local: true,
      _remote: normalized,
    }
  })

  return { resolved, cache, report }
}

function resolveLocalSources (opts) {
  const { spawnSync } = require('node:child_process')
  const os = require('node:os')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-sync-'))
  const optsPath = path.join(tmpDir, 'opts.json')
  const outPath = path.join(tmpDir, 'out.json')
  try {
    fs.writeFileSync(optsPath, JSON.stringify(opts))
    const script = `
      const fs = require('node:fs')
      const opts = JSON.parse(fs.readFileSync(${JSON.stringify(optsPath)}, 'utf8'))
      const { resolveLocalSourcesAsync } = require(${JSON.stringify(path.join(__dirname, 'resolve.js'))})
      resolveLocalSourcesAsync(opts).then(r => {
        fs.writeFileSync(${JSON.stringify(outPath)}, JSON.stringify(r))
      }).catch(e => { console.error(e); process.exit(1) })
    `
    const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 })
    if (run.status !== 0) throw new Error(run.stderr || 'resolveLocalSources failed')
    return JSON.parse(fs.readFileSync(outPath, 'utf8'))
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  resolveLocalSources,
  resolveLocalSourcesAsync,
  heuristicHivePath,
  isGitCheckout,
  chooseLocalRoot,
  cacheGetValid,
  loadCacheFile: (cachePath) => {
    if (!cachePath || !fs.existsSync(cachePath)) return { version: 2, entries: {} }
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      if (!cache.entries) cache.entries = {}
      return cache
    } catch {
      return { version: 2, entries: {} }
    }
  },
  MARKER_FILENAME,
}
