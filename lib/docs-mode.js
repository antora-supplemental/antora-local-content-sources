'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { loadCacheFile } = require('./resolve')
const { runningInCi } = require('./ui-env')
const { parseConfirmToken, ENV_CONFIRM } = require('./confirm-search')

const ENV_MODE = 'ANTORA_LOCAL_SOURCES_MODE'

/**
 * Remembered path choice lives on the gitignored local-content cache.
 * @param {object} [cache]
 * @returns {'local' | 'remote' | null}
 */
function rememberedDocsMode (cache) {
  const value = cache && cache.ui && cache.ui.docsMode
  if (value === 'local' || value === 'remote') return value
  return null
}

/**
 * @param {string} cachePath
 * @param {'local' | 'remote'} mode
 */
function saveDocsMode (cachePath, mode) {
  if (mode !== 'local' && mode !== 'remote') return
  const cache = loadCacheFile(cachePath)
  if (!cache.ui || typeof cache.ui !== 'object') cache.ui = {}
  cache.ui.docsMode = mode
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n')
}

/**
 * CI never scans. CONFIRM=no is cache-only. CONFIRM=yes scans on the shell
 * outside CI. MODE=ask|local|remote overrides the remembered choice.
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.cachePath]
 * @returns {'remote' | 'local-shell' | 'local' | 'ask'}
 */
function resolveDocsMode ({ env, cachePath } = {}) {
  const e = env || process.env
  if (runningInCi(e)) return 'remote'
  const confirm = parseConfirmToken(e[ENV_CONFIRM])
  if (confirm === 'no') return 'cache-only'
  if (confirm === 'yes') return 'local-shell'
  const override = String(e[ENV_MODE] || '').trim().toLowerCase()
  if (override === 'ask') return 'ask'
  if (override === 'local') return 'local'
  if (override === 'remote') return 'remote'
  const remembered = rememberedDocsMode(cachePath ? loadCacheFile(cachePath) : null)
  if (remembered) return remembered
  return 'ask'
}

module.exports = {
  ENV_MODE,
  rememberedDocsMode,
  saveDocsMode,
  resolveDocsMode,
}
