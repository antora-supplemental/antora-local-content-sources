'use strict'

const fs = require('node:fs')
const path = require('node:path')
const yaml = require('yaml')
const { normalizeGitRemoteUrl } = require('./marker-id')

const DEFAULT_OVERRIDE_BASENAMES = ['.antora-local-sources.yml', '.antora-local-sources.yaml']

/**
 * @param {string} playbookDir
 * @param {string | string[] | undefined} configured
 * @returns {string[]}
 */
function defaultOverridePaths (playbookDir, configured) {
  if (configured) {
    const list = Array.isArray(configured) ? configured : [configured]
    return list.map((p) => path.resolve(playbookDir, p))
  }
  return DEFAULT_OVERRIDE_BASENAMES.map((name) => path.join(playbookDir, name))
}

/**
 * @param {string[]} paths
 * @returns {Record<string, string>}
 */
function loadPathOverrides (paths) {
  /** @type {Record<string, string>} */
  const map = {}
  for (const filePath of paths) {
    if (!filePath || !fs.existsSync(filePath)) continue
    let doc
    try {
      doc = yaml.parse(fs.readFileSync(filePath, 'utf8')) || {}
    } catch {
      continue
    }
    const block = doc.sources || doc.overrides || doc.paths || doc
    if (!block || typeof block !== 'object') continue
    for (const [key, value] of Object.entries(block)) {
      if (value == null) continue
      let localPath
      if (typeof value === 'string') localPath = value
      else if (typeof value === 'object' && value.path) localPath = String(value.path)
      else continue
      const k = String(key).trim()
      if (!k) continue
      if (/^https?:\/\//i.test(k) || /^git@/i.test(k)) {
        map[normalizeGitRemoteUrl(k)] = path.resolve(localPath)
      } else {
        map[k] = path.resolve(localPath)
      }
    }
  }
  return map
}

/**
 * @param {Record<string, string>} overrides
 * @param {string} normalizedRemote
 * @param {string} markerBasename
 * @returns {string | null}
 */
function pickOverridePath (overrides, normalizedRemote, markerBasename) {
  if (overrides[normalizedRemote]) return overrides[normalizedRemote]
  if (overrides[markerBasename]) return overrides[markerBasename]
  return null
}

module.exports = {
  DEFAULT_OVERRIDE_BASENAMES,
  defaultOverridePaths,
  loadPathOverrides,
  pickOverridePath,
}
