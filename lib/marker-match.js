'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {
  MARKER_BASENAME,
  markerIdForRemote,
  normalizeGitRemoteUrl,
  parseMarkerFile,
} = require('./marker-id')

/**
 * @param {string} repoRoot
 * @param {string} normalizedRemote
 * @param {string} markerId
 * @returns {boolean}
 */
function markerContentMatchesRemote (repoRoot, normalizedRemote, markerId) {
  const primary = path.join(repoRoot, MARKER_BASENAME)
  if (fs.existsSync(primary)) {
    try {
      const parsed = parseMarkerFile(fs.readFileSync(primary, 'utf8'))
      if (parsed.url === normalizedRemote) return true
      if (parsed.id && parsed.id === markerId) return true
    } catch {
      /* ignore */
    }
  }
  const deprecated = path.join(repoRoot, `.antora-src-${markerId}`)
  if (fs.existsSync(deprecated)) {
    try {
      const parsed = parseMarkerFile(fs.readFileSync(deprecated, 'utf8'))
      if (parsed.url === normalizedRemote || !parsed.url) {
        const body = fs.readFileSync(deprecated, 'utf8').trim().split(/\r?\n/)[0].trim()
        if (normalizeGitRemoteUrl(body) === normalizedRemote) return true
      }
      if (parsed.url === normalizedRemote) return true
    } catch {
      return true
    }
  }
  return false
}

/**
 * @param {string[]} markerFilePaths absolute paths to marker files
 * @param {string} normalizedRemote
 * @param {string} markerId
 * @returns {string[]} clone roots
 */
function cloneRootsFromMarkerFiles (markerFilePaths, normalizedRemote, markerId) {
  const out = []
  const seen = new Set()
  for (const fp of markerFilePaths) {
    const root = path.resolve(path.dirname(fp))
    if (seen.has(root)) continue
    if (!markerContentMatchesRemote(root, normalizedRemote, markerId)) continue
    seen.add(root)
    out.push(root)
  }
  return out
}

module.exports = {
  markerContentMatchesRemote,
  cloneRootsFromMarkerFiles,
  MARKER_BASENAME,
}
