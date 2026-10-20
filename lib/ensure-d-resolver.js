'use strict'

const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { localResolverTriplet, resolverReleaseAssetInfo } = require('./platform-triplet')

const DEFAULT_REPO = 'antora-supplemental/antora-source-resolver'
const DEFAULT_RELEASE = 'v0.1.2'

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
function fetchBuffer (url) {
  return new Promise((resolve, reject) => {
    const follow = (target) => {
      https
        .get(target, { headers: { 'User-Agent': 'antora-local-content-sources' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${target}`))
            res.resume()
            return
          }
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        .on('error', reject)
    }
    follow(url)
  })
}

/**
 * @param {string} cacheDir
 * @param {string} triplet
 * @returns {string}
 */
function cachedBinaryPath (cacheDir, triplet) {
  const { binaryName } = resolverReleaseAssetInfo(triplet)
  const base = `antora-source-resolver-${triplet}`
  if (process.platform === 'win32') return path.join(cacheDir, `${base}.exe`)
  return path.join(cacheDir, base)
}

/**
 * @param {string} archivePath
 * @param {string} destBinary
 * @param {string} triplet
 */
function extractReleaseArchive (archivePath, destBinary, triplet) {
  const { archiveExt, binaryName } = resolverReleaseAssetInfo(triplet)
  fs.mkdirSync(path.dirname(destBinary), { recursive: true })
  if (archiveExt === '.zip') {
    const destDir = path.dirname(destBinary)
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: 'pipe' }
      )
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', destDir], { stdio: 'pipe' })
    }
    const extracted = path.join(destDir, binaryName)
    if (fs.existsSync(extracted) && extracted !== destBinary) {
      fs.renameSync(extracted, destBinary)
    }
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', path.dirname(destBinary)], { stdio: 'pipe' })
    const extracted = path.join(path.dirname(destBinary), binaryName)
    if (fs.existsSync(extracted) && extracted !== destBinary) {
      fs.renameSync(extracted, destBinary)
    }
  }
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(destBinary, 0o755)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Download and cache the D resolver from GitHub Releases when missing.
 *
 * @param {object} [opts]
 * @param {string} [opts.cacheDir]
 * @param {string} [opts.releaseTag]
 * @param {string} [opts.repo]
 * @param {boolean} [opts.autoDownload]
 * @returns {Promise<string | null>} path to binary
 */
async function ensureDResolverBinary (opts = {}) {
  if (opts.autoDownload === false) return null
  const cacheDir = path.resolve(opts.cacheDir || path.join('build', '.antora', 'bin'))
  const triplet = localResolverTriplet()
  const dest = cachedBinaryPath(cacheDir, triplet)
  if (fs.existsSync(dest)) return dest

  const releaseTag = opts.releaseTag || DEFAULT_RELEASE
  const repo = opts.repo || DEFAULT_REPO
  const assetName = `antora-source-resolver-${triplet}${resolverReleaseAssetInfo(triplet).archiveExt}`
  const url = `https://github.com/${repo}/releases/download/${releaseTag}/${assetName}`

  fs.mkdirSync(cacheDir, { recursive: true })
  const archivePath = path.join(cacheDir, assetName)
  try {
    const buf = await fetchBuffer(url)
    fs.writeFileSync(archivePath, buf)
    extractReleaseArchive(archivePath, dest, triplet)
    try {
      fs.unlinkSync(archivePath)
    } catch {
      /* ignore */
    }
    if (fs.existsSync(dest)) return dest
  } catch {
    try {
      fs.unlinkSync(archivePath)
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * @param {object} [opts]
 * @returns {string | null}
 */
function ensureDResolverBinarySync (opts = {}) {
  const { spawnSync } = require('node:child_process')
  const script = `
    const { ensureDResolverBinary } = require(${JSON.stringify(__filename)})
    ensureDResolverBinary(${JSON.stringify(opts)}).then(p => {
      process.stdout.write(JSON.stringify(p))
    }).catch(() => process.exit(1))
  `
  const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 600_000 })
  if (run.status !== 0) return null
  try {
    return JSON.parse(run.stdout || 'null')
  } catch {
    return null
  }
}

module.exports = {
  DEFAULT_REPO,
  DEFAULT_RELEASE,
  ensureDResolverBinary,
  ensureDResolverBinarySync,
  cachedBinaryPath,
  fetchBuffer,
}
