'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { markerBasenameForRemote, normalizeGitRemoteUrl, githubOwnerRepo } = require('./marker-id')
const { collectMarkerCloneRoots, DEFAULT_MAX_DEPTH, MARKER_FILENAME, walkCollectMarkerFiles } = require('./search')
const { defaultOverridePaths, loadPathOverrides, pickOverridePath } = require('./overrides')

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

/**
 * @param {string[]} roots
 * @param {string} normalizedRemote
 * @param {number} maxDepth
 * @returns {string[]}
 */
function collectLegacyMarkerRoots (roots, normalizedRemote, maxDepth) {
  const hits = []
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue
    walkCollectMarkerFiles(path.resolve(root), MARKER_FILENAME, maxDepth, null, hits)
  }
  const out = []
  const seen = new Set()
  for (const hit of hits) {
    const repoRoot = path.dirname(hit)
    if (!markerContentMatches(repoRoot, normalizedRemote)) continue
    const key = path.resolve(repoRoot)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(repoRoot)
  }
  return out
}

/**
 * @param {string} root
 * @param {string} markerBasename
 * @param {string} normalizedRemote
 * @returns {boolean}
 */
function rootHasMarker (root, markerBasename, normalizedRemote) {
  if (fs.existsSync(path.join(root, markerBasename))) return true
  return markerContentMatches(root, normalizedRemote)
}

/**
 * @param {string[]} matches
 * @param {string | null} overridePath
 * @param {string} markerBasename
 * @param {string} normalizedRemote
 * @returns {{ localRoot: string | null, method: string, overrideUsed: boolean }}
 */
function chooseLocalRoot (matches, overridePath, markerBasename, normalizedRemote) {
  if (overridePath) {
    const resolved = path.resolve(overridePath)
    if (rootHasMarker(resolved, markerBasename, normalizedRemote) && isGitCheckout(resolved)) {
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
 * @param {object[]} opts.sources playbook content.sources
 * @param {string[]} opts.searchRoots
 * @param {string} [opts.startDir]
 * @param {string} opts.cachePath
 * @param {number} [opts.maxDepth]
 * @param {string[]} [opts.overridePaths]
 * @param {boolean} [opts.searchOtherDrives]
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
    let matches = []
    let localRoot = cacheGetValid(cache, marker)
    let method = 'cache'
    let overrideUsed = false

    if (!localRoot) {
      matches = await collectMarkerCloneRoots({
        startDir,
        markerBasename: marker,
        maxDepth,
        maxUpwardHops,
        extraRoots: searchRoots,
        searchOtherDrives: opts.searchOtherDrives,
      })
      if (!matches.length) {
        matches = collectLegacyMarkerRoots(searchRoots.length ? searchRoots : [startDir], normalized, maxDepth)
        if (matches.length) method = 'legacy-marker'
      }
      if (!matches.length) {
        const hive = heuristicHivePath(searchRoots.length ? searchRoots : [startDir], url)
        if (hive) matches = [hive]
        if (hive) method = 'hive-heuristic'
      }

      const overridePath = pickOverridePath(overrides, normalized, marker)
      const choice = chooseLocalRoot(matches, overridePath, marker, normalized)
      localRoot = choice.localRoot
      method = choice.method === 'none' ? method : choice.method
      overrideUsed = choice.overrideUsed
    } else {
      matches = [localRoot]
    }

    const conflict = matches.length > 1 && !overrideUsed
    if (localRoot) {
      cachePut(cache, marker, localRoot)
      byRemote.set(normalized, localRoot)
    }

    report.push({
      remote: normalized,
      marker,
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

/**
 * @param {object} opts
 * @returns {{ resolved: object[], cache: object, report: object[] }}
 */
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
  MARKER_FILENAME,
}
