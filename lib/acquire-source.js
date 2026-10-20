'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { formatMarkerFile, githubOwnerRepo, normalizeGitRemoteUrl, MARKER_BASENAME } = require('./marker-id')

/**
 * Antora stores bare clones in <cache>/content/<name>-<sha1>.git.
 * @param {object} [playbook]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function antoraContentCacheDir (playbook, env) {
  const e = env || process.env
  const requested = playbook && playbook.runtime && playbook.runtime.cacheDir
  const startDir = (playbook && playbook.dir) || process.cwd()
  let base
  if (requested) {
    base = path.resolve(startDir, String(requested))
  } else if (process.platform === 'win32' && e.LOCALAPPDATA) {
    base = path.join(e.LOCALAPPDATA, 'antora')
  } else if (e.XDG_CACHE_HOME) {
    base = path.join(e.XDG_CACHE_HOME, 'antora')
  } else {
    const home = e.HOME || e.USERPROFILE
    base = home ? path.join(home, '.cache', 'antora') : path.resolve('.antora/cache')
  }
  return path.join(base, 'content')
}

/**
 * Same folder name Antora 3 uses for a remote.
 * @param {string} remoteUrl
 * @returns {string}
 */
function antoraCloneFolderName (remoteUrl) {
  const normalized = normalizeGitRemoteUrl(remoteUrl).toLowerCase().replace(/\.git$/, '')
  const basename = normalized.split(/[:/]/).pop() || 'repo'
  const hash = crypto.createHash('sha1').update(normalized).digest('hex')
  return basename + '-' + hash + '.git'
}

/**
 * @param {string} contentCacheDir
 * @param {string} remoteUrl
 * @returns {string | null}
 */
function findAntoraClone (contentCacheDir, remoteUrl) {
  if (!contentCacheDir || !fs.existsSync(contentCacheDir)) return null
  const folder = path.join(contentCacheDir, antoraCloneFolderName(remoteUrl))
  if (!fs.existsSync(folder)) return null
  if (!fs.existsSync(path.join(folder, 'HEAD')) && !fs.existsSync(path.join(folder, '.git'))) return null
  return folder
}

/**
 * Hive root when the playbook lives under <root>/github.com/<org>/<repo>.
 * Otherwise CODE_ROOT / code.
 * @param {string} playbookDir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
function hiveRoot (playbookDir, env) {
  const resolved = path.resolve(playbookDir || '.')
  const parts = resolved.split(path.sep)
  const idx = parts.findIndex((part) => part.toLowerCase() === 'github.com')
  if (idx > 0) return parts.slice(0, idx).join(path.sep)
  const e = env || {}
  return e.CODE_ROOT || e.code || e.CODE || null
}

/**
 * @param {string} playbookDir
 * @param {string} remoteUrl
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
function dedicatedRepoDir (playbookDir, remoteUrl, env) {
  const gh = githubOwnerRepo(remoteUrl)
  if (!gh) return null
  const root = hiveRoot(playbookDir, env)
  if (!root) return null
  return path.join(root, 'github.com', gh.owner, gh.repo)
}

function isEmptyDir (dir) {
  if (!fs.existsSync(dir)) return true
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return false
  }
  return entries.length === 0
}

function markerMatches (dir, remoteUrl) {
  const markerPath = path.join(dir, MARKER_BASENAME)
  if (!fs.existsSync(markerPath)) return false
  const text = fs.readFileSync(markerPath, 'utf8')
  return text.includes(normalizeGitRemoteUrl(remoteUrl))
}

function originMatches (dir, remoteUrl) {
  const run = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (run.status !== 0) return false
  return normalizeGitRemoteUrl(run.stdout || '') === normalizeGitRemoteUrl(remoteUrl)
}

function isThisRepo (dir, remoteUrl) {
  if (!fs.existsSync(dir) || isEmptyDir(dir)) return false
  return markerMatches(dir, remoteUrl) || originMatches(dir, remoteUrl)
}

function writeMarker (dir, remoteUrl) {
  fs.writeFileSync(path.join(dir, MARKER_BASENAME), formatMarkerFile(remoteUrl))
}

function gitClone (source, dest) {
  const run = spawnSync('git', ['clone', source, dest], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (run.status !== 0) {
    const detail = (run.stderr || run.stdout || 'git clone failed').trim()
    throw new Error(detail.split(/\r?\n/).pop() || 'git clone failed')
  }
}

/**
 * Move an Antora content-cache clone, or clone the remote, into the hive folder.
 * Never deletes a non-empty directory that is a different repo.
 * @param {object} input
 * @returns {{ ok: boolean, url: string, path: string | null, status: string, error: string }}
 */
function acquireSource (input) {
  const url = String(input.url || '')
  const playbookDir = input.playbookDir || process.cwd()
  const env = input.env || process.env
  const dest = dedicatedRepoDir(playbookDir, url, env)
  const base = { url, path: dest, status: 'error', error: '', ok: false }
  if (!dest) {
    return { ...base, error: 'no hive folder for this remote' }
  }
  if (isThisRepo(dest, url)) {
    writeMarker(dest, url)
    return { ok: true, url, path: dest, status: 'validated', error: '' }
  }
  if (fs.existsSync(dest) && !isEmptyDir(dest)) {
    return { ...base, error: 'destination exists and is not this repo' }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (fs.existsSync(dest) && isEmptyDir(dest)) {
    fs.rmSync(dest, { recursive: true, force: true })
  }
  const cached = findAntoraClone(input.antoraContentCache, url)
  try {
    gitClone(cached || url, dest)
  } catch (err) {
    return { ...base, error: String(err.message || err).slice(0, 180) }
  }
  writeMarker(dest, url)
  if (cached) {
    try {
      fs.rmSync(cached, { recursive: true, force: true })
    } catch {
      /* the hive checkout is what the build uses */
    }
  }
  return { ok: true, url, path: dest, status: 'validated', error: '' }
}

/**
 * @param {object} playbook
 * @param {string} logPath
 */
function applyAcquireLog (playbook, logPath) {
  if (!logPath || !fs.existsSync(logPath) || !playbook || !playbook.content) return
  const lines = fs.readFileSync(logPath, 'utf8').split(/\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row.ok || !row.path) continue
    const key = normalizeGitRemoteUrl(row.url || '')
    for (const src of playbook.content.sources || []) {
      const url = String(src.url || '')
      if (url === row.url || normalizeGitRemoteUrl(url) === key) {
        src.url = row.path
        src.worktrees = true
      }
    }
  }
}

function rowButton ({ status, localRoot, antoraContentCache, remoteUrl }) {
  if (localRoot && antoraContentCache && isInside(localRoot, antoraContentCache)) return 'Move'
  if (status === 'validated' || (localRoot && !isInside(localRoot, antoraContentCache || ''))) return 'Local'
  if (remoteUrl && findAntoraClone(antoraContentCache, remoteUrl)) return 'Move'
  return 'Download'
}

function isInside (child, parent) {
  if (!child || !parent) return false
  const root = path.resolve(parent).toLowerCase()
  const target = path.resolve(child).toLowerCase()
  return target === root || target.startsWith(root + path.sep)
}

if (require.main === module) {
  const inputPath = process.argv[2]
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const result = acquireSource(input)
  if (input.log) {
    fs.mkdirSync(path.dirname(input.log), { recursive: true })
    fs.appendFileSync(input.log, JSON.stringify(result) + '\n')
  }
  process.stdout.write(JSON.stringify(result))
}

module.exports = {
  antoraContentCacheDir,
  antoraCloneFolderName,
  findAntoraClone,
  hiveRoot,
  dedicatedRepoDir,
  acquireSource,
  applyAcquireLog,
  rowButton,
}
