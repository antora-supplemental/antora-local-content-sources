'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { markerIdForRemote, MARKER_BASENAME, normalizeGitRemoteUrl } = require('./marker-id')
const { resolveLocalSources, MARKER_FILENAME } = require('./resolve')
const { defaultOverridePaths, loadPathOverrides } = require('./overrides')
const { ensureDResolverBinarySync } = require('./ensure-d-resolver')
const { tryDResolve } = require('./spawn-d-resolver')
const { writeResolvedPlaybook } = require('./write-playbook')
const { diskSearchNeeded } = require('./confirm-search')
const { cacheGetValid, loadCacheFile } = require('./resolve')
const { announcePhase, reportLine } = require('./progress-log')
const { askToSearch } = require('./search-ui')

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

function logConflict (logger, row, sink) {
  reportLine(logger, `multiple local clones for ${row.remote} (id ${row.markerId}):`, sink)
  for (const p of row.matches) reportLine(logger, `  - ${p}`, sink)
  reportLine(
    logger,
    `using ${row.localRoot} (${row.method}). Pin one path in .antora-local-sources.yml (see antora-local-content-sources README).`,
    sink
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
    const cacheNote = remotes.length
      ? `checking ${remotes.length} remote content source(s) against cache (${path.relative(playbookDir, cachePath)})`
      : null

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

    const searchCheck = diskSearchNeeded(remotes, cachePath)
    let sink = null
    if (searchCheck.needed) {
      const asked = askToSearch({
        logger,
        missingCount: searchCheck.missingCount,
        total: searchCheck.total,
        payload,
        config,
      })
      if (!asked.proceed) {
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
            logger.info('local content (cache only): %s -> %s', normalized, localRoot)
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
      sink = asked.sink
    }

    let result
    try {
    if (cacheNote) announcePhase(logger, cacheNote, sink)
    if (!searchCheck.needed) {
      announcePhase(logger, `cache valid for all ${searchCheck.total} remote source(s) - skipping disk search`)
      result = resolveLocalSources(payload)
    } else {
      let dBinary = config.dBinary
      if (!dBinary && config.dAutoDownload !== false) {
        announcePhase(logger, 'downloading or locating antora-source-resolver binary (one-time per machine/arch)', sink)
        dBinary =
          ensureDResolverBinarySync({
            autoDownload: true,
            cacheDir: binCacheDir,
            releaseTag: config.dRelease,
            repo: config.dRepo,
          }) || undefined
      }

      const t0 = Date.now()
      announcePhase(
        logger,
        dBinary
          ? `running disk search via D resolver (${dBinary}) - please wait`
          : 'running disk search via Node resolver - please wait',
        sink
      )
      result = tryDResolve(payload, dBinary)
      if (result) {
        announcePhase(
          logger,
          `disk search finished in ${((Date.now() - t0) / 1000).toFixed(1)}s (D resolver)`,
          sink
        )
      } else {
        if (process.platform === 'win32' && payload.searchMethod !== 'walk') {
          reportLine(
            logger,
            'D resolver unavailable on Windows - NTFS MFT volume search skipped (upward/extra roots only). ' +
              'Allow auto-download, set dBinary, or run elevated if volume access fails.',
            sink
          )
        }
        result = resolveLocalSources(payload)
        announcePhase(
          logger,
          `disk search finished in ${((Date.now() - t0) / 1000).toFixed(1)}s (Node resolver)`,
          sink
        )
      }
    }

    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(result.cache, null, 2) + '\n')

    const byRemote = new Map()
    for (const row of result.report) {
      if (row.conflict && row.localRoot) logConflict(logger, row, sink)
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
        logger.info('local content: %s -> %s', normalized, localRoot)
      } else {
        remoteCount++
        reportLine(
          logger,
          `no local clone for ${normalized} (add ${MARKER_BASENAME} with id+url lines, or clone under %code%/github.com/...)`,
          sink
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
    } finally {
      if (sink && typeof sink.finish === 'function') sink.finish()
    }
  })
}
