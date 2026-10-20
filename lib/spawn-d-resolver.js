'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * Optional D accelerator (@antora-supplemental/antora-source-resolver).
 * Returns null when the binary is missing or fails.
 *
 * @param {object} payload same shape as resolveLocalSources input
 * @param {string} [binaryName]
 * @returns {object | null}
 */
function tryDResolve (payload, binaryName = 'antora-source-resolver') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-src-'))
  const reqPath = path.join(tmpDir, 'request.json')
  const resPath = path.join(tmpDir, 'response.json')
  try {
    fs.writeFileSync(reqPath, JSON.stringify(payload))
    const run = spawnSync(binaryName, ['resolve', reqPath, resPath], {
      encoding: 'utf8',
      timeout: 120_000,
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

module.exports = { tryDResolve }
