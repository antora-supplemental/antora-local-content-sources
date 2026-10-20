'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ensureDResolverBinary } = require('./ensure-d-resolver')

/**
 * Optional D accelerator (@antora-supplemental/antora-source-resolver).
 * Returns null when the binary is missing or fails.
 *
 * @param {object} payload same shape as resolveLocalSources input
 * @param {object} [spawnOpts]
 * @param {string} [spawnOpts.binaryPath]
 * @param {boolean} [spawnOpts.autoDownload]
 * @param {string} [spawnOpts.cacheDir]
 * @param {string} [spawnOpts.releaseTag]
 * @param {string} [spawnOpts.repo]
 * @returns {Promise<object | null>}
 */
async function tryDResolveAsync (payload, spawnOpts = {}) {
  let binaryPath = spawnOpts.binaryPath
  if (!binaryPath && spawnOpts.autoDownload !== false) {
    binaryPath = await ensureDResolverBinary({
      autoDownload: true,
      cacheDir: spawnOpts.cacheDir,
      releaseTag: spawnOpts.releaseTag,
      repo: spawnOpts.repo,
    })
  }
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    binaryPath = spawnOpts.fallbackName || 'antora-source-resolver'
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-src-'))
  const reqPath = path.join(tmpDir, 'request.json')
  const resPath = path.join(tmpDir, 'response.json')
  try {
    fs.writeFileSync(reqPath, JSON.stringify(payload))
    const run = spawnSync(binaryPath, ['resolve', reqPath, resPath], {
      encoding: 'utf8',
      timeout: 300_000,
      windowsHide: true,
    })
    if (run.status !== 0) return null
    if (!fs.existsSync(resPath)) return null
    return JSON.parse(fs.readFileSync(resPath, 'utf8'))
  } catch {
    return null
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} payload
 * @param {string} [binaryName]
 * @returns {object | null}
 */
function tryDResolve (payload, binaryPath) {
  const name = binaryPath || 'antora-source-resolver'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-src-'))
  const reqPath = path.join(tmpDir, 'request.json')
  const resPath = path.join(tmpDir, 'response.json')
  try {
    fs.writeFileSync(reqPath, JSON.stringify(payload))
    const run = spawnSync(name, ['resolve', reqPath, resPath], {
      encoding: 'utf8',
      timeout: 300_000,
      windowsHide: true,
    })
    if (run.status !== 0) return null
    if (!fs.existsSync(resPath)) return null
    return JSON.parse(fs.readFileSync(resPath, 'utf8'))
  } catch {
    return null
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

module.exports = { tryDResolve, tryDResolveAsync }
