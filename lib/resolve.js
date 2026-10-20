'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { markerBasenameForRemote, normalizeGitRemoteUrl, githubOwnerRepo } = require('./marker-id')

const DEFAULT_MAX_DEPTH = 10
const MARKER_FILENAME = '.antora-source-id'

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
 * @param {string[]} roots
 * @param {string} markerBasename
 * @param {number} maxDepth
 * @returns {string | null} directory containing the marker
 */
function findMarkerRoot (roots, markerBasename, maxDepth = DEFAULT_MAX_DEPTH) {
  for (const root of roots) {
    if (!root) continue
    let abs
    try {
      abs = path.resolve(root)
    } catch {
      continue
    }
    if (!fs.existsSync(abs)) continue
    const hit = walkForFile(abs, markerBasename, maxDepth)
    if (hit) return path.dirname(hit)
  }
  return null
}

/**
 * @param {string} dir
 * @param {string} basename
 * @param {number} depth
 * @returns {string | null}
 */
function walkForFile (dir, basename, depth) {
  if (depth < 0) return null
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const ent of entries) {
    if (ent.name === basename || ent.name === MARKER_FILENAME) {
      const full = path.join(dir, ent.name)
      if (ent.isFile()) return full
    }
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'build') continue
    const full = path.join(dir, ent.name)
    const nested = walkForFile(full, basename, depth - 1)
    if (nested) return nested
  }
  return null
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
 * @param {string} markerBasename
 * @param {string} localRoot
 */
function cachePut (cache, markerBasename, localRoot) {
  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(path.join(localRoot, markerBasename)).mtimeMs
  } catch {
    try {
      mtimeMs = fs.statSync(path.join(localRoot, MARKER_FILENAME)).mtimeMs
    } catch {
      mtimeMs = Date.now()
    }
  }
  cache.entries[markerBasename] = {
    path: localRoot,
    mtimeMs,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * @param {object} cache
 * @param {string} markerBasename
 * @returns {string | null}
 */
function cacheGetValid (cache, markerBasename) {
  const row = cache.entries?.[markerBasename]
  if (!row?.path) return null
  const root = path.resolve(row.path)
  const markerPath = [path.join(root, markerBasename), path.join(root, MARKER_FILENAME)].find((p) =>
    fs.existsSync(p)
  )
  if (!markerPath) return null
  try {
    const mtimeMs = fs.statSync(markerPath).mtimeMs
    if (row.mtimeMs && mtimeMs !== row.mtimeMs) return null
  } catch {
    return null
  }
  return root
}

/**
 * @param {object} opts
 * @param {object[]} opts.sources playbook content.sources
 * @param {string[]} opts.searchRoots
 * @param {string} opts.cachePath
 * @param {number} [opts.maxDepth]
 * @returns {{ resolved: object[], cache: object, report: object[] }}
 */
function resolveLocalSources (opts) {
  const sources = opts.sources || []
  const searchRoots = [...new Set((opts.searchRoots || []).map((r) => path.resolve(r)))]
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  let cache = { version: 1, entries: {} }
  if (opts.cachePath && fs.existsSync(opts.cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(opts.cachePath, 'utf8'))
      if (!cache.entries) cache.entries = {}
    } catch {
      cache = { version: 1, entries: {} }
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

    const marker = markerBasenameForRemote(url)
    let localRoot = cacheGetValid(cache, marker)
    let method = 'cache'
    if (!localRoot) {
      localRoot = findMarkerRoot(searchRoots, marker, maxDepth)
      method = localRoot ? 'marker-search' : 'none'
    }
    if (!localRoot) {
      localRoot = findMarkerRoot(searchRoots, MARKER_FILENAME, maxDepth)
      if (localRoot && markerContentMatches(localRoot, normalized)) {
        method = 'legacy-marker'
      } else if (localRoot && !markerContentMatches(localRoot, normalized)) {
        localRoot = null
      }
    }
    if (!localRoot) {
      localRoot = heuristicHivePath(searchRoots, url)
      method = localRoot ? 'hive-heuristic' : 'none'
    }
    if (localRoot) {
      cachePut(cache, marker, localRoot)
      byRemote.set(normalized, localRoot)
    }
    report.push({
      remote: normalized,
      marker,
      localRoot: localRoot || null,
      method,
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

/**
 * @param {string} repoRoot
 * @param {string} normalizedRemote
 * @returns {boolean}
 */
function markerContentMatches (repoRoot, normalizedRemote) {
  const legacy = path.join(repoRoot, MARKER_FILENAME)
  if (!fs.existsSync(legacy)) return false
  try {
    const body = fs.readFileSync(legacy, 'utf8').trim().split(/\r?\n/)[0].trim()
    return normalizeGitRemoteUrl(body) === normalizedRemote
  } catch {
    return false
  }
}

module.exports = {
  resolveLocalSources,
  findMarkerRoot,
  heuristicHivePath,
  isGitCheckout,
  MARKER_FILENAME,
}
