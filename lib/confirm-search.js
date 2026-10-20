'use strict'

const fs = require('node:fs')
const { markerIdForRemote, normalizeGitRemoteUrl, MARKER_BASENAME } = require('./marker-id')
const { cacheGetValid, loadCacheFile } = require('./resolve')
const { desktopSessionAvailable, runningInCi, uiPreference } = require('./ui-env')

/** Env / config bypass tokens (also echoed in the interactive prompt for agents). */
const ENV_CONFIRM = 'ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH'
const ENV_MODE = 'ANTORA_LOCAL_SOURCES_MODE'
const BYPASS_HINT =
  `Scripting bypass: set ${ENV_CONFIRM}=yes to search without prompting, or ${ENV_CONFIRM}=no to skip search and use remote URLs only. ` +
  `Change the remembered path choice with ${ENV_MODE}=ask|local|remote (ask shows Use local docs / Use remote docs again). ` +
  'Force the terminal banner instead of a window: set ANTORA_LOCAL_SOURCES_UI=tty.'

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
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function confirmEnvBypass (env) {
  const mode = parseConfirmToken(env && env[ENV_CONFIRM])
  return mode === 'yes' || mode === 'no'
}

/**
 * @param {object} [config]
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {boolean} [opts.stdinIsTTY]
 * @param {string} [opts.platform]
 * @returns {'yes' | 'no' | 'prompt'}
 */
function confirmSearchPreflight (config = {}, opts = {}) {
  const env = opts.env || process.env
  const stdinIsTTY = opts.stdinIsTTY !== undefined ? opts.stdinIsTTY : Boolean(process.stdin.isTTY)
  const platform = opts.platform || process.platform

  // CI never scans, even when CONFIRM_SEARCH=yes or confirmSearch is never-prompt.
  if (runningInCi(env)) return 'no'

  const fromEnv = parseConfirmToken(env[ENV_CONFIRM])
  if (fromEnv === 'yes' || fromEnv === 'no') return fromEnv

  const cfg = config.confirmSearch
  if (cfg === false || cfg === 'never-prompt' || cfg === 'skip-prompt') return 'yes'
  if (cfg === 'no-search' || cfg === 'skip') return 'no'
  if (cfg === true || cfg === 'always-prompt') return 'prompt'

  // Headless and forced-terminal runs keep today's non-TTY default (search).
  // A Windows desktop session can still show the dialog when stdin is not a TTY.
  if (uiPreference(env) === 'tty') return stdinIsTTY ? 'prompt' : 'yes'
  if (!stdinIsTTY && !desktopSessionAvailable(env, platform)) return 'yes'
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
 * Interactive question. "remote source(s)" keeps a space between the words.
 * @param {number} missingCount
 * @param {number} total
 * @returns {string}
 */
function formatConfirmQuestion (missingCount, total) {
  return (
    `\nLocal content: cached clone path is missing or invalid for ${missingCount} of ${total} remote source(s).\n` +
    `Search this machine for ${MARKER_BASENAME} markers? (Can take minutes - MFT/drive scan on Windows.)\n` +
    `${BYPASS_HINT}\n` +
    `Proceed with search? [Y/n] `
  )
}

/**
 * @param {object} opts
 * @param {object} opts.logger
 * @param {number} opts.missingCount
 * @param {number} opts.total
 * @param {object} [opts.config]
 * @returns {boolean} proceed with disk search
 */
function confirmSearchIfNeeded ({ logger, missingCount, total, config, onBeforePrompt }) {
  const mode = confirmSearchPreflight(config)
  if (mode === 'yes') return true
  if (mode === 'no') {
    logger.warn('local content disk search skipped (%s=no). Using remote URLs for uncached sources.', ENV_CONFIRM)
    return false
  }

  if (typeof onBeforePrompt === 'function') onBeforePrompt()

  const question = formatConfirmQuestion(missingCount, total)

  try {
    process.stderr.write(question)
  } catch {
    logger.warn('%s', question.replace(/\n/g, ' '))
  }
  if (!readTerminalAnswer(logger)) {
    logger.warn('local content disk search declined at prompt; using remote URLs for uncached sources.')
    return false
  }
  return true
}

/**
 * Read one Y/n line from stdin. Empty input and unreadable stdin mean yes.
 * @param {object} logger
 * @returns {boolean}
 */
function readTerminalAnswer (logger) {
  try {
    const buf = Buffer.alloc(256)
    const n = fs.readSync(process.stdin.fd, buf, 0, 256, null)
    const answer = buf.slice(0, n).toString('utf8').trim().toLowerCase()
    if (answer === 'n' || answer === 'no') return false
  } catch (err) {
    logger.warn('could not read confirmation (%s); proceeding with search.', err.message || err)
  }
  return true
}

module.exports = {
  ENV_CONFIRM,
  ENV_MODE,
  BYPASS_HINT,
  confirmEnvBypass,
  confirmSearchPreflight,
  diskSearchNeeded,
  confirmSearchIfNeeded,
  formatConfirmQuestion,
  parseConfirmToken,
  readTerminalAnswer,
  runningInCi,
}
