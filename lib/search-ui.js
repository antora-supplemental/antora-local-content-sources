'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const { markerIdForRemote, normalizeGitRemoteUrl } = require('./marker-id')
const { cacheGetValid, loadCacheFile } = require('./resolve')
const { rowButton } = require('./acquire-source')
const { resolveDocsMode, saveDocsMode } = require('./docs-mode')
const {
  BYPASS_HINT,
  ENV_CONFIRM,
  confirmEnvBypass,
  confirmSearchPreflight,
  formatConfirmQuestion,
  readTerminalAnswer,
} = require('./confirm-search')
const { announceDiskSearchPlan } = require('./progress-log')
const { desktopSessionAvailable, uiPreference } = require('./ui-env')

/**
 * Openshell tools are not used here. terminal-gui-prompts is a single
 * MessageBox (no sections, no live log) and it echoes the prompt to stdout.
 * nu-emit is a C JSONL writer. prohelp is a D help TUI. None of them can host
 * this confirm-then-progress window from the Antora Node extension without a
 * new runtime. Windows PowerShell WinForms is already on the machine.
 */

/**
 * @param {object} opts
 * @param {'yes' | 'no' | 'prompt'} opts.preflight
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {string} opts.platform
 * @returns {'skip' | 'tty-confirm' | 'tty-progress' | 'gui-confirm' | 'gui-progress'}
 */
function resolveSearchChannel ({ preflight, env, platform }) {
  if (preflight === 'no') return 'skip'
  const preferTty = uiPreference(env) === 'tty'
  const desktop = !preferTty && desktopSessionAvailable(env, platform)
  if (preflight === 'yes') {
    // Env yes/no is the agent bypass: shell text, no dialog, no second prompt.
    if (confirmEnvBypass(env) || !desktop) return 'tty-progress'
    return 'gui-progress'
  }
  if (desktop) return 'gui-confirm'
  return 'tty-confirm'
}

/**
 * @param {object} opts
 * @param {number} opts.missingCount
 * @param {number} opts.total
 * @param {object} [opts.payload]
 * @param {string} [opts.platform]
 */
function isRemoteUrl (url) {
  return /^https?:\/\//i.test(url) || /^git@/i.test(url)
}

/**
 * Playbook URLs with the status the cache check can already prove.
 * Uncached rows stay "waiting" until disk search starts.
 * @param {object} [payload]
 * @returns {{ url: string, key: string, status: 'waiting' | 'validated' }[]}
 */
function sourceRows (payload = {}) {
  const sources = Array.isArray(payload.sources) ? payload.sources : []
  const cache = payload.cachePath ? loadCacheFile(payload.cachePath) : null
  const rows = []
  for (const src of sources) {
    const url = String(src && src.url || '')
    if (!isRemoteUrl(url)) continue
    const key = normalizeGitRemoteUrl(url)
    let status = 'waiting'
    let localRoot = ''
    if (cache) {
      const hit = cacheGetValid(cache, markerIdForRemote(url), key)
      if (hit) {
        status = 'validated'
        localRoot = hit
      }
    }
    const button = rowButton({
      status,
      localRoot,
      antoraContentCache: payload.antoraContentCache,
      remoteUrl: url,
    })
    rows.push({ url, key, status, button, localRoot })
  }
  return rows
}

/**
 * Map a resolver report row onto the list. Cache hits are the existing
 * validation. A located clone is found. No path is not found.
 * @param {object} [row]
 * @returns {'validated' | 'found' | 'not found'}
 */
function statusForReportRow (row) {
  if (!row || !row.localRoot) return 'not found'
  if (row.method === 'cache') return 'validated'
  return 'found'
}

/**
 * @param {{ source?: (url: string, status: string) => void } | null} sink
 * @param {object[]} remotes
 * @param {string} cachePath
 */
function emitSearching (sink, remotes, cachePath) {
  if (!sink || typeof sink.source !== 'function') return
  const cache = loadCacheFile(cachePath)
  for (const src of remotes || []) {
    const url = String(src && src.url || '')
    if (!isRemoteUrl(url)) continue
    const key = normalizeGitRemoteUrl(url)
    if (!cacheGetValid(cache, markerIdForRemote(url), key)) sink.source(url, 'searching')
  }
}

/**
 * @param {{ source?: (url: string, status: string) => void } | null} sink
 * @param {object[]} [report]
 * @param {object[]} [remotes]
 */
function emitReport (sink, report, remotes, antoraContentCache) {
  if (!sink || typeof sink.source !== 'function') return
  const payloadAntoraCache = antoraContentCache || ''
  const display = new Map()
  for (const src of remotes || []) {
    const url = String(src && src.url || '')
    if (!url) continue
    display.set(normalizeGitRemoteUrl(url), url)
  }
  for (const row of report || []) {
    const url = display.get(row.remote) || row.remote
    const status = statusForReportRow(row)
    const button = rowButton({
      status,
      localRoot: row.localRoot,
      antoraContentCache: payloadAntoraCache,
      remoteUrl: url,
    })
    sink.source(url, status, button)
  }
}

function buildConfirmModel ({ payload = {} }) {
  return {
    title: 'Antora Local content search',
    heading: 'Search for local Antora docs?',
    lead: 'Your Antora project sources its docs from online repositories. This build process will find local copies on your machine to use. If none are found, the build will download copies into a cache for fast rebuilds.',
    detail: 'This build process will search for .antora-source-id marker files to identify local clones of docs sources.',
    bypass: BYPASS_HINT,
    sources: sourceRows(payload),
    playbookDir: payload.startDir || payload.playbookDir || '',
    antoraContentCache: payload.antoraContentCache || '',
    nodePath: payload.nodePath || process.execPath,
    acquireScript: payload.acquireScript || '',
    acquireLog: payload.acquireLog || '',
  }
}

/**
 * HTML snapshot of the confirm dialog. The live window is WinForms; this
 * document is the section contract tests lock in.
 * @param {ReturnType<typeof buildConfirmModel>} model
 * @returns {string}
 */
function renderConfirmHtml (model) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const rows = (model.sources || []).map((row) =>
    '<tr><td>' + esc(row.url) + '</td><td>' + esc(row.status) + '</td><td>' + esc(row.button || '') + '</td></tr>'
  )
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>' + esc(model.title) + '</title></head>',
    '<body>',
    '<h1>' + esc(model.heading) + '</h1>',
    '<p>' + esc(model.lead) + '</p>',
    '<p>' + esc(model.detail) + '</p>',
    '<section><h2>Scripting bypass</h2><p>' + esc(model.bypass) + '</p></section>',
    '<table><thead><tr><th>Remote URL</th><th>Status</th><th>Action</th></tr></thead><tbody>',
    rows.join('\n'),
    '</tbody></table>',
    '<button type="button">Use local docs</button>',
    '<button type="button">Use remote docs</button>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * Ask before a disk search, using a Windows dialog when this is a desktop
 * session. Shell output (banner, Y/n, phase lines) is the fallback.
 * @param {object} opts
 * @returns {{ proceed: boolean, sink: object | null }}
 */
function askToSearch (opts) {
  const logger = opts.logger || { warn () {} }
  const env = opts.env || process.env
  const platform = opts.platform || process.platform
  const stdinIsTTY = opts.stdinIsTTY !== undefined ? opts.stdinIsTTY : Boolean(process.stdin.isTTY)
  const preflight = opts.preflight || confirmSearchPreflight(opts.config || {}, { env, platform, stdinIsTTY })
  let docsMode = opts.docsMode || resolveDocsMode({
    env,
    cachePath: opts.payload && opts.payload.cachePath,
  })
  const useShell = (willPrompt) => {
    announceDiskSearchPlan({
      logger,
      missingCount: opts.missingCount,
      total: opts.total,
      payload: opts.payload || {},
      willPrompt,
    })
    if (!willPrompt) return { proceed: true, sink: null }
    const question = formatConfirmQuestion(opts.missingCount, opts.total)
    try {
      process.stderr.write(question)
    } catch {
      logger.warn('%s', question.replace(/\n/g, ' '))
    }
    const read = opts.readAnswer || readTerminalAnswer
    if (!read(logger)) {
      logger.warn('local content disk search declined at prompt; using remote URLs for uncached sources.')
      return { proceed: false, sink: null, rewriteCache: true }
    }
    return { proceed: true, sink: null }
  }

  if (docsMode === 'remote') {
    return { proceed: false, sink: null, docsMode: 'remote', rewriteCache: false }
  }
  if (docsMode === 'cache-only' || preflight === 'no') {
    logger.warn(
      'local content disk search skipped (%s=no). Using remote URLs for uncached sources.',
      ENV_CONFIRM
    )
    return { proceed: false, sink: null, docsMode: 'cache-only', rewriteCache: true }
  }

  const preferTty = uiPreference(env) === 'tty'
  const desktop = !preferTty && desktopSessionAvailable(env, platform)
  const model = buildConfirmModel({
    missingCount: opts.missingCount,
    total: opts.total,
    payload: opts.payload,
    platform,
  })
  const launch = opts.launch || startWindowsDialog

  if (docsMode === 'ask' && desktop) {
    try {
      const chooser = launch({ model, mode: 'choose' })
      const picked = chooser && typeof chooser.choice === 'function' ? chooser.choice() : 'remote'
      docsMode = picked === 'local' ? 'local' : 'remote'
      if (opts.payload && opts.payload.cachePath) saveDocsMode(opts.payload.cachePath, docsMode)
      if (docsMode === 'remote') return { proceed: false, sink: null, docsMode: 'remote', rewriteCache: false }
      if (opts.searchNeeded === false) return { proceed: true, sink: null, docsMode: 'local' }
    } catch (err) {
      const reason = oneLine(err && err.message ? err.message : err)
      logger.warn('local content dialog could not start (%s); using terminal output.', reason)
      return useShell(true)
    }
  }

  const channel = docsMode === 'local' && desktop
    ? 'gui-progress'
    : docsMode === 'local-shell'
      ? 'tty-progress'
      : resolveSearchChannel({ preflight, env, platform })

  if (channel === 'skip') {
    logger.warn(
      'local content disk search skipped (%s=no). Using remote URLs for uncached sources.',
      ENV_CONFIRM
    )
    return { proceed: false, sink: null, rewriteCache: true }
  }

  if (channel === 'tty-confirm') return useShell(true)
  if (channel === 'tty-progress') return useShell(false)

  try {
    const ui = launch({ model, mode: 'progress' })
    return { proceed: true, sink: ui }
  } catch (err) {
    const reason = oneLine(err && err.message ? err.message : err)
    logger.warn('local content dialog could not start (%s); using terminal output.', reason)
    return useShell(false)
  }
}

function oneLine (value) {
  return String(value || 'dialog failed').replace(/\s+/g, ' ').trim().slice(0, 300)
}

function sleepSync (ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readTrim (file) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

function readPid (pidPath) {
  const raw = readTrim(pidPath)
  const pid = Number(raw)
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}

function pidAlive (pid) {
  if (!pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

function killPid (pidPath) {
  const pid = readPid(pidPath)
  if (!pid) return
  try {
    process.kill(pid)
  } catch {
    /* already gone */
  }
}

function waitForReady (readyPath, pidPath, errorPath) {
  const start = Date.now()
  while (Date.now() - start < 20000) {
    if (readTrim(readyPath)) return
    const pid = readPid(pidPath)
    const errText = readTrim(errorPath)
    if (pid && !pidAlive(pid)) {
      throw new Error(oneLine(errText || 'dialog process exited before it was ready'))
    }
    sleepSync(50)
  }
  killPid(pidPath)
  throw new Error(oneLine(readTrim(errorPath) || 'dialog did not open'))
}

function waitForDecision (decisionPath, pidPath) {
  while (true) {
    const answer = readTrim(decisionPath)
    if (answer === 'yes' || answer === 'local') return true
    if (answer === 'no' || answer === 'remote') return false
    const pid = readPid(pidPath)
    if (pid && !pidAlive(pid)) return false
    sleepSync(50)
  }
}

function appendEvent (file, event) {
  try {
    fs.appendFileSync(file, JSON.stringify(event) + '\n')
  } catch {
    /* window closed or file busy; the build continues */
  }
}

function psQuote (value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function systemExe (name) {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return path.join(root, 'System32', name)
}

/**
 * Hidden PowerShell WinForms window. Decision and progress travel through
 * files so the Node side stays synchronous and the console does not flash.
 * @param {{ model: object, mode: 'confirm' | 'progress' }} opts
 */
function startWindowsDialog ({ model, mode }) {
  if (process.platform !== 'win32') {
    throw new Error('no Windows desktop dialog on this platform')
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-ui-'))
  const requestPath = path.join(tmp, 'request.json')
  const decisionPath = path.join(tmp, 'decision.txt')
  const progressPath = path.join(tmp, 'progress.jsonl')
  const readyPath = path.join(tmp, 'ready.txt')
  const errorPath = path.join(tmp, 'error.txt')
  const pidPath = path.join(tmp, 'pid.txt')
  const runnerPath = path.join(tmp, 'run.ps1')
  const vbsPath = path.join(tmp, 'launch.vbs')
  const scriptPath = path.join(__dirname, 'search-dialog.ps1')

  fs.writeFileSync(requestPath, JSON.stringify(model))
  fs.writeFileSync(progressPath, '')
  const runner = [
    '& ' + psQuote(scriptPath),
    '-Request ' + psQuote(requestPath),
    '-Decision ' + psQuote(decisionPath),
    '-Progress ' + psQuote(progressPath),
    '-Ready ' + psQuote(readyPath),
    '-ErrorLog ' + psQuote(errorPath),
    '-PidFile ' + psQuote(pidPath),
    '-Mode ' + psQuote(mode),
  ].join(' ')
  fs.writeFileSync(runnerPath, runner + '\r\n')

  const ps = systemExe('WindowsPowerShell\\v1.0\\powershell.exe')
  const command = [
    ps,
    '-NoProfile',
    '-STA',
    '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass',
    '-File',
    runnerPath,
  ].map(quoteCmd).join(' ')
  fs.writeFileSync(
    vbsPath,
    'CreateObject("Wscript.Shell").Run "' + command.replace(/"/g, '""') + '", 0, False\r\n'
  )
  const child = spawn(systemExe('wscript.exe'), ['//nologo', vbsPath], {
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()

  waitForReady(readyPath, pidPath, errorPath)

  return {
    mode: 'gui',
    stop () {
      killPid(pidPath)
    },
    confirm () {
      return waitForDecision(decisionPath, pidPath)
    },
    choice () {
      const answer = readTrim(decisionPath)
      if (answer === 'local' || answer === 'remote') return answer
      return waitForDecision(decisionPath, pidPath) ? 'local' : 'remote'
    },
    phase (text) {
      appendEvent(progressPath, { type: 'phase', text: String(text) })
    },
    conflict (text) {
      appendEvent(progressPath, { type: 'conflict', text: String(text) })
    },
    source (url, status, button) {
      const event = { type: 'source', url: String(url), status: String(status) }
      if (button) event.button = String(button)
      appendEvent(progressPath, event)
    },
    finish (ok) {
      const success = ok !== false
      appendEvent(progressPath, {
        type: 'done',
        ok: success,
        text: success ? 'Finished.' : 'Finished with errors.',
      })
    },
  }
}

function quoteCmd (arg) {
  const s = String(arg)
  if (!/[\s"]/.test(s)) return s
  return '"' + s.replace(/"/g, '\\"') + '"'
}

module.exports = {
  resolveSearchChannel,
  buildConfirmModel,
  renderConfirmHtml,
  sourceRows,
  statusForReportRow,
  emitSearching,
  emitReport,
  askToSearch,
  startWindowsDialog,
}
