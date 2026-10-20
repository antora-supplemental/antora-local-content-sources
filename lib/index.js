'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { markerIdForRemote, MARKER_BASENAME, normalizeGitRemoteUrl } = require('./marker-id')
const { resolveLocalSources, MARKER_FILENAME } = require('./resolve')
const { defaultOverridePaths, loadPathOverrides } = require('./overrides')
const { ensureDResolverBinarySync } = require('./ensure-d-resolver')
const { tryDResolve } = require('./spawn-d-resolver')
const { writeResolvedPlaybook } = require('./write-playbook')
const { diskSearchNeeded, confirmSearchIfNeeded } = require('./confirm-search')
const { cacheGetValid, loadCacheFile } = require('./resolve')

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

function logConflict (logger, row) {
  logger.warn('multiple local clones for %s (id %s):', row.remote, row.markerId)
  for (const p of row.matches) logger.warn('  - %s', p)
  logger.warn(
    'using %s (%s). Pin one path in .antora-local-sources.yml (see antora-local-content-sources README).',
    row.localRoot,
    row.method
  )
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
    const binCacheDir = path.resolve(playbookDir, config.dCacheDir || path.join('build', '.antora', 'bin'))
    const searchRoots = defaultSearchRoots(playbookDir, config.searchRoots || [])
    const overridePaths = defaultOverridePaths(playbookDir, config.overridesFile)
    const overrides = loadPathOverrides(overridePaths)

    const remotes = playbook.content.sources.filter((s) => /^https?:\/\//i.test(String(s.url || '')))
    const searchCheck = diskSearchNeeded(remotes, cachePath)
    if (
      searchCheck.needed &&
      !confirmSearchIfNeeded({
        logger,
        missingCount: searchCheck.missingCount,
        total: searchCheck.total,
        config,
      })
    ) {
      const cache = loadCacheFile(cachePath)
      let localCount = 0
      let remoteCount = 0
      for (const src of playbook.content.sources) {
        const url = String(src.url || '')
        if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) continue
        const normalized = normalizeGitRemoteUrl(url)
        const markerId = markerIdForRemote(url)
        const localRoot = cacheGetValid(cache, markerId, normalized)
        if (localRoot) {
          src.url = localRoot
          src.worktrees = true
          localCount++
          logger.info('local content (cache only): %s → %s', normalized, localRoot)
        } else {
          remoteCount++
        }
      }
      logger.info(
        'local content sources: %s local, %s remote (disk search skipped; cache: %s)',
        localCount,
        remoteCount,
        path.relative(playbookDir, cachePath)
      )
      return
    }

    const payload = {
      sources: remotes,
      searchRoots,
      startDir: playbookDir,
      cachePath,
      maxDepth: config.maxDepth,
      overridePaths,
      overrides,
      searchOtherDrives: config.searchOtherDrives !== false,
      searchMethod: config.searchMethod || process.env.ANTORA_LOCAL_SOURCES_SEARCH_METHOD || 'auto',
    }

    let result
    if (!searchCheck.needed) {
      result = resolveLocalSources(payload)
    } else {
      let dBinary = config.dBinary
      if (!dBinary && config.dAutoDownload !== false) {
        dBinary =
          ensureDResolverBinarySync({
            autoDownload: true,
            cacheDir: binCacheDir,
            releaseTag: config.dRelease,
            repo: config.dRepo,
          }) || undefined
      }

      result = tryDResolve(payload, dBinary)
      if (result) {
        logger.info('used D resolver (%s)', dBinary || 'antora-source-resolver')
      } else {
        if (process.platform === 'win32' && payload.searchMethod !== 'walk') {
          logger.warn(
            'D resolver unavailable on Windows — NTFS MFT volume search skipped (upward/extra roots only). ' +
              'Allow auto-download, set dBinary, or run elevated if volume access fails.'
          )
        }
        result = resolveLocalSources(payload)
      }
    }

    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(result.cache, null, 2) + '\n')

    const byRemote = new Map()
    for (const row of result.report) {
      if (row.conflict && row.localRoot) logConflict(logger, row)
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
          'no local clone for %s (add %s with id+url lines, or clone under %%code%%/github.com/…)',
          normalized,
          MARKER_BASENAME
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
