'use strict'

const os = require('node:os')
const { BYPASS_HINT, ENV_CONFIRM } = require('./confirm-search')
const { MARKER_BASENAME } = require('./marker-id')

const BANNER_WIDTH = 72

/**
 * Greedy wrap to `inner` columns. A token longer than `inner` is hard-broken
 * so every piece still fits between the borders.
 * @param {string} text
 * @param {number} inner
 * @returns {string[]}
 */
function wrapBannerText (text, inner) {
  const limit = Math.max(1, inner)
  const paragraphs = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out = []
  for (const para of paragraphs) {
    if (!para.trim()) {
      out.push('')
      continue
    }
    let current = ''
    for (const word of para.trim().split(/\s+/)) {
      if (word.length > limit) {
        if (current) {
          out.push(current)
          current = ''
        }
        for (let i = 0; i < word.length; i += limit) out.push(word.slice(i, i + limit))
        continue
      }
      if (!current) {
        current = word
      } else if (current.length + 1 + word.length <= limit) {
        current += ` ${word}`
      } else {
        out.push(current)
        current = word
      }
    }
    if (current) out.push(current)
  }
  return out.length ? out : ['']
}

/**
 * ASCII frame (`-`, `|`). Each body row is exactly `width` columns:
 * `| ` + text + ` |`, with long sentences continued on the next framed row.
 * Box-drawing characters are not used: Antora's pino logger writes UTF-8 bytes
 * to fd 2, and a CP437/Windows-1252 console decodes them as mojibake.
 * @param {string[]} lines
 * @param {number} [width]
 * @returns {string}
 */
function formatBanner (lines, width = BANNER_WIDTH) {
  const bar = '-'.repeat(width)
  const inner = Math.max(1, width - 4)
  const framed = []
  for (const line of lines) {
    for (const piece of wrapBannerText(line, inner)) {
      framed.push(`| ${piece.padEnd(inner)} |`)
    }
  }
  return [bar, ...framed, bar].join('\n')
}

/**
 * One-line ASCII summary for the Antora logger. No frame characters.
 * @param {object} opts
 * @param {number} opts.missingCount
 * @param {number} opts.total
 * @param {boolean} opts.willPrompt
 * @returns {string}
 */
function diskSearchSummary ({ missingCount, total, willPrompt }) {
  const next = willPrompt ? 'waiting for confirmation' : 'proceeding without a prompt'
  return `local content disk search: ${missingCount} of ${total} remote source(s) uncached; ${next}`
}

/**
 * @param {object} opts
 * @param {number} opts.missingCount
 * @param {number} opts.total
 * @param {object} opts.payload
 * @param {boolean} opts.willPrompt
 * @returns {string[]}
 */
function buildDiskSearchLines ({ missingCount, total, payload, willPrompt }) {
  const searchMethod = payload.searchMethod || 'auto'
  const mft =
    process.platform === 'win32' && searchMethod !== 'walk'
      ? 'Windows NTFS MFT volume scan (can take several minutes per drive)'
      : 'directory walks on configured drives/roots'
  const drives =
    payload.searchOtherDrives !== false
      ? 'current volume + other drives'
      : 'current volume only'
  return [
    'Local content sources - disk search starting next',
    '',
    `Why: cached clone paths missing/invalid for ${missingCount} of ${total} remote source(s).`,
    `What: find ${MARKER_BASENAME} markers, then read id/url inside each file.`,
    `How: ${mft}; scope: ${drives}.`,
    '',
    willPrompt
      ? 'Waiting for your confirmation below (or enter Y).'
      : `Non-interactive or ${ENV_CONFIRM}=yes - proceeding without prompt.`,
    BYPASS_HINT,
  ]
}

/**
 * Banner once on stderr (a JS string, so a Windows TTY uses WriteConsoleW).
 * The logger gets only the ASCII summary, never the frame, so pino cannot
 * re-encode box-drawing bytes onto the console code page.
 * @param {object} logger Antora logger
 * @param {string[]} lines
 * @param {string} [summary]
 */
function emitBanner (logger, lines, summary) {
  const block = formatBanner(lines)
  const oneLine = summary || lines.find((line) => String(line).trim()) || 'local content disk search'
  if (logger && typeof logger.warn === 'function') logger.warn('%s', oneLine)
  try {
    process.stderr.write(block + os.EOL)
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} opts
 * @param {object} opts.logger
 * @param {number} opts.missingCount
 * @param {number} opts.total
 * @param {object} opts.payload
 * @param {boolean} opts.willPrompt
 */
function announceDiskSearchPlan (opts) {
  const lines = buildDiskSearchLines(opts)
  emitBanner(opts.logger, lines, diskSearchSummary(opts))
}

/**
 * Antora's pino logger writes UTF-8 bytes. A Windows console on the OEM code
 * page turns an em dash into Gamma-C-cedilla garbage and can swallow the
 * following space. Logger text stays ASCII (hyphen, three dots, normal spaces).
 * @param {string} text
 * @returns {string}
 */
function asciiLog (text) {
  return String(text)
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2192/g, '->')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\n\r\t\x20-\x7E]/g, '')
}

/**
 * One user-facing line. A GUI sink keeps it off the shell. Otherwise the
 * Antora logger gets it once, as ASCII, with no matching stderr copy.
 * @param {object} logger
 * @param {string} detail
 * @param {{ mode?: string, phase?: (text: string) => void }} [sink]
 */
function reportLine (logger, detail, sink) {
  const msg = asciiLog(detail)
  if (sink && sink.mode === 'gui' && typeof sink.phase === 'function') {
    sink.phase(msg)
    return
  }
  if (logger && typeof logger.warn === 'function') logger.warn('%s', msg)
}

/**
 * @param {object} logger
 * @param {string} detail
 * @param {{ mode?: string, phase?: (text: string) => void }} [sink]
 */
function announcePhase (logger, detail, sink) {
  reportLine(logger, `[local-content-sources] ${detail}`, sink)
}

module.exports = {
  BANNER_WIDTH,
  formatBanner,
  wrapBannerText,
  diskSearchSummary,
  buildDiskSearchLines,
  emitBanner,
  announceDiskSearchPlan,
  announcePhase,
  asciiLog,
  reportLine,
}
