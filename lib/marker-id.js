'use strict'

const crypto = require('node:crypto')

/** Namespace for deterministic marker ids (stable org salt). */
const MARKER_NAMESPACE = 'antora-supplemental:local-content-sources:v1'

/** Fixed marker file at clone root (stable id lives in file body, not the name). */
const MARKER_BASENAME = '.antora-source-id'

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
 * Stable 32-hex id for a git remote (stored inside `.antora-source-id`, not in the filename).
 * @param {string} remoteUrl
 * @returns {string}
 */
function markerIdForRemote (remoteUrl) {
  const key = normalizeGitRemoteUrl(remoteUrl)
  return crypto
    .createHash('sha256')
    .update(MARKER_NAMESPACE)
    .update('\0')
    .update(key)
    .digest('hex')
    .slice(0, 32)
}

/** @deprecated Use markerIdForRemote; kept for override keys that used `.antora-src-*` basename. */
function markerBasenameForRemote (remoteUrl) {
  return `.antora-src-${markerIdForRemote(remoteUrl)}`
}

/**
 * @param {string} remoteUrl
 * @returns {string} file body for a new marker file
 */
function formatMarkerFile (remoteUrl) {
  const url = normalizeGitRemoteUrl(remoteUrl)
  const id = markerIdForRemote(remoteUrl)
  return `${MARKER_NAMESPACE}\nid: ${id}\nurl: ${url}\n`
}

/**
 * @param {string} text
 * @returns {{ id: string | null, url: string | null }}
 */
function parseMarkerFile (text) {
  let id = null
  let url = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line === MARKER_NAMESPACE) continue
    const idm = line.match(/^id:\s*([0-9a-f]{32})\s*$/i)
    if (idm) {
      id = idm[1].toLowerCase()
      continue
    }
    const urlm = line.match(/^url:\s*(.+)\s*$/i)
    if (urlm) {
      url = normalizeGitRemoteUrl(urlm[1])
      continue
    }
    if (!url && (/^https?:\/\//i.test(line) || /^git@/i.test(line))) {
      url = normalizeGitRemoteUrl(line)
    }
  }
  return { id, url }
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
  MARKER_BASENAME,
  normalizeGitRemoteUrl,
  markerIdForRemote,
  markerBasenameForRemote,
  formatMarkerFile,
  parseMarkerFile,
  githubOwnerRepo,
}
