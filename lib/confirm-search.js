'use strict'

const fs = require('node:fs')
const { markerIdForRemote, normalizeGitRemoteUrl, MARKER_BASENAME } = require('./marker-id')
const { cacheGetValid, loadCacheFile } = require('./resolve')

/** Env / config bypass tokens (also echoed in the interactive prompt for agents). */
const ENV_CONFIRM = 'ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH'
const BYPASS_HINT =
  `Scripting bypass: set ${ENV_CONFIRM}=yes to search without prompting, or ${ENV_CONFIRM}=no to skip search and use remote URLs only.`

/**
 * @param {string | undefined} raw
 * @returns {'yes' | 'no' | 'prompt' | null}
 */
function parseConfirmToken (raw) {
  if (raw == null || raw === '') return null
  const v = String(raw).trim().toLowerCase()
  if (v === '1' || v === 'yes' || v === 'true' || v === 'y') return 'yes'
  if (v === '0' || v === 'no' || v === 'false' || v === 'n') return 'no'
  return 'prompt'
}

/**
 * @param {object} [config]
 * @returns {'yes' | 'no' | 'prompt' | null}
 */
function confirmSearchPreflight (config = {}) {
  const fromEnv = parseConfirmToken(process.env[ENV_CONFIRM])
  if (fromEnv === 'yes' || fromEnv === 'no') return fromEnv

  const cfg = config.confirmSearch
  if (cfg === false || cfg === 'never-prompt' || cfg === 'skip-prompt') return 'yes'
  if (cfg === 'no-search' || cfg === 'skip') return 'no'
  if (cfg === true || cfg === 'always-prompt') return 'prompt'

  if (!process.stdin.isTTY) return 'yes'
  return 'prompt'
}

/**
 * True when at least one remote lacks a valid cached clone path (disk search likely).
 * @param {object[]} remotes
 * @param {string} cachePath
 * @returns {{ needed: boolean, missingCount: number, total: number }}
 */
function diskSearchNeeded (remotes, cachePath) {
  const cache = loadCacheFile(cachePath)
  let missingCount = 0
  let total = 0
  for (const src of remotes) {
    const url = String(src.url || '')
    if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) continue
    total++
    const normalized = normalizeGitRemoteUrl(url)
    const markerId = markerIdForRemote(url)
    if (!cacheGetValid(cache, markerId, normalized)) missingCount++
  }
  return { needed: missingCount > 0, missingCount, total }
}

/**
 * @param {object} opts
 * @param {object} opts.logger
 * @param {number} opts.missingCount
 * @param {number} opts.total
 * @param {object} [opts.config]
 * @returns {boolean} proceed with disk search
 */
function confirmSearchIfNeeded ({ logger, missingCount, total, config }) {
  const mode = confirmSearchPreflight(config)
  if (mode === 'yes') return true
  if (mode === 'no') {
    logger.warn('local content disk search skipped (%s=no). Using remote URLs for uncached sources.', ENV_CONFIRM)
    return false
  }

  const question =
    `\nLocal content: cached clone path is missing or invalid for ${missingCount} of ${total} remote source(s).\n` +
    `Search this machine for ${MARKER_BASENAME} markers? (Can take minutes — MFT/drive scan on Windows.)\n` +
    `${BYPASS_HINT}\n` +
    `Proceed with search? [Y/n] `

  process.stderr.write(question)
  try {
    const buf = Buffer.alloc(256)
    const n = fs.readSync(process.stdin.fd, buf, 0, 256, null)
    const answer = buf.slice(0, n).toString('utf8').trim().toLowerCase()
    if (answer === 'n' || answer === 'no') {
      logger.warn('local content disk search declined at prompt; using remote URLs for uncached sources.')
      return false
    }
  } catch (err) {
    logger.warn('could not read confirmation (%s); proceeding with search.', err.message || err)
  }
  return true
}

module.exports = {
  ENV_CONFIRM,
  BYPASS_HINT,
  confirmSearchPreflight,
  diskSearchNeeded,
  confirmSearchIfNeeded,
  parseConfirmToken,
}
