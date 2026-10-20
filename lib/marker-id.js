'use strict'

const crypto = require('node:crypto')

/** Namespace for deterministic marker ids (not a real UUID namespace — stable org salt). */
const MARKER_NAMESPACE = 'antora-supplemental:local-content-sources:v1'

/**
 * Normalize Git remote URLs so https/ssh/.git variants map to one key.
 * @param {string} url
 * @returns {string}
 */
function normalizeGitRemoteUrl (url) {
  let u = String(url || '').trim()
  if (!u) return ''
  u = u.replace(/\\/g, '/').replace(/\/+$/, '')
  u = u.replace(/\.git$/i, '')
  const ssh = u.match(/^git@github\.com:([^/]+)\/(.+)$/i)
  if (ssh) u = `https://github.com/${ssh[1]}/${ssh[2]}`
  const scp = u.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i)
  if (scp) u = `https://github.com/${scp[1]}/${scp[2]}`
  try {
    const parsed = new URL(u)
    if (parsed.hostname.toLowerCase() === 'github.com') {
      parsed.hostname = 'github.com'
      parsed.protocol = 'https:'
      parsed.pathname = parsed.pathname.replace(/\/+$/, '')
      u = parsed.toString().replace(/\/+$/, '')
    }
  } catch {
    /* leave as-is */
  }
  return u.toLowerCase()
}

/**
 * Stable marker basename for a clone (one marker per git remote, not per start_path).
 * @param {string} remoteUrl
 * @returns {string} e.g. `.antora-src-a1b2c3d4e5f6…`
 */
function markerBasenameForRemote (remoteUrl) {
  const key = normalizeGitRemoteUrl(remoteUrl)
  const digest = crypto
    .createHash('sha256')
    .update(MARKER_NAMESPACE)
    .update('\0')
    .update(key)
    .digest('hex')
    .slice(0, 32)
  return `.antora-src-${digest}`
}

/**
 * Parse owner/repo from a normalized GitHub https URL.
 * @param {string} remoteUrl
 * @returns {{ owner: string, repo: string } | null}
 */
function githubOwnerRepo (remoteUrl) {
  const key = normalizeGitRemoteUrl(remoteUrl)
  const m = key.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

module.exports = {
  MARKER_NAMESPACE,
  normalizeGitRemoteUrl,
  markerBasenameForRemote,
  githubOwnerRepo,
}
