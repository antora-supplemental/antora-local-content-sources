'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { markerBasenameForRemote, normalizeGitRemoteUrl } = require('./marker-id')
const { resolveLocalSources, MARKER_FILENAME } = require('./resolve')
const { tryDResolve } = require('./spawn-d-resolver')
const { writeResolvedPlaybook } = require('./write-playbook')

const PACKAGE_ID = '@antora-supplemental/antora-local-content-sources'

/**
 * @param {string | undefined} mode auto | on | off
 * @returns {boolean}
 */
function shouldEnable (mode) {
  const m = String(mode || 'auto').toLowerCase()
  if (m === 'off' || m === 'false' || m === '0') return false
  if (m === 'on' || m === 'true' || m === '1') return true
  if (process.env.ANTORA_LOCAL_SOURCES === '0') return false
  if (process.env.ANTORA_LOCAL_SOURCES === '1') return true
  if (process.env.CI === 'true' || process.env.CI === '1') return false
  if (process.env.GITHUB_ACTIONS === 'true') return false
  return true
}

/**
 * @param {string} playbookDir
 * @param {string[]} extra
 * @returns {string[]}
 */
function defaultSearchRoots (playbookDir, extra = []) {
  const roots = new Set()
  const add = (p) => {
    if (!p) return
    try {
      roots.add(path.resolve(p))
    } catch {
      /* ignore */
    }
  }
  add(playbookDir)
  add(path.join(playbookDir, '..'))
  add(process.env.CODE_ROOT)
  add(process.env.code)
  add(process.env.CODE)
  add(process.env.HOME && path.join(process.env.HOME, 'code'))
  add(process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'code'))
  for (const r of extra) add(r)
  return [...roots]
}

function unwrapConfig (ctx) {
  if (!ctx || typeof ctx !== 'object') return {}
  const inner = ctx.config && typeof ctx.config === 'object' && !Array.isArray(ctx.config) ? ctx.config : null
  return inner ? { ...inner } : { ...ctx }
}

module.exports.register = function register (context = {}) {
  const logger = this.getLogger(PACKAGE_ID)
  let config = unwrapConfig(context)

  this.on('playbookBuilt', ({ playbook }) => {
    config = { ...unwrapConfig(context) }
    if (!shouldEnable(config.mode)) {
      logger.info('local content source resolution disabled (mode=%s)', config.mode || 'auto')
      return
    }
    if (!playbook?.content?.sources?.length) return

    const playbookDir = playbook.dir || process.cwd()
    const cacheDir = path.resolve(playbookDir, config.cacheDir || 'build/.antora')
    const cachePath = path.resolve(cacheDir, config.cacheFile || 'local-content-cache.json')
    const searchRoots = defaultSearchRoots(playbookDir, config.searchRoots || [])

    const remotes = playbook.content.sources.filter((s) => /^https?:\/\//i.test(String(s.url || '')))
    const payload = {
      sources: remotes,
      searchRoots,
      cachePath,
      maxDepth: config.maxDepth,
    }

    let result = tryDResolve(payload, config.dBinary)
    if (!result) {
      result = resolveLocalSources(payload)
    } else {
      logger.info('used D resolver (%s)', config.dBinary || 'antora-source-resolver')
    }

    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(result.cache, null, 2) + '\n')

    const byRemote = new Map()
    for (const row of result.report) {
      if (row.localRoot) byRemote.set(row.remote, row.localRoot)
    }

    let localCount = 0
    let remoteCount = 0
    for (const src of playbook.content.sources) {
      const url = String(src.url || '')
      if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) continue
      const normalized = normalizeGitRemoteUrl(url)
      const localRoot = byRemote.get(normalized)
      if (localRoot) {
        src.url = localRoot
        src.worktrees = true
        localCount++
        logger.info('local content: %s → %s', normalized, localRoot)
      } else {
        remoteCount++
        logger.warn(
          'no local clone for %s (add %s or %s with canonical URL, or clone under %%code%%/github.com/…)',
          normalized,
          markerBasenameForRemote(url),
          MARKER_FILENAME
        )
      }
    }

    if (config.writeResolvedPlaybook !== false) {
      const out = path.resolve(
        playbookDir,
        config.resolvedPlaybookPath || 'build/.antora/antora-playbook-local.generated.yml'
      )
      writeResolvedPlaybook(playbook, out)
      logger.info('wrote %s', path.relative(playbookDir, out))
    }

    logger.info(
      'local content sources: %s local, %s remote (cache: %s)',
      localCount,
      remoteCount,
      path.relative(playbookDir, cachePath)
    )
  })
}
