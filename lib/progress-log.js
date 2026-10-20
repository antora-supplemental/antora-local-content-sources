'use strict'

const os = require('node:os')
const { BYPASS_HINT, ENV_CONFIRM } = require('./confirm-search')
const { MARKER_BASENAME } = require('./marker-id')

const BANNER_WIDTH = 72

/**
 * ASCII frame (`-`, `|`). Safe on Windows consoles and if a line is ever logged.
 * Box-drawing characters are not used: Antora's pino logger writes UTF-8 bytes
 * to fd 2, and a CP437/Windows-1252 console decodes them as mojibake.
 * @param {string[]} lines
 * @param {number} [width]
 * @returns {string}
 */
function formatBanner (lines, width = BANNER_WIDTH) {
  const bar = '-'.repeat(width)
  const inner = Math.max(0, width - 4)
  const body = lines.map((line) => {
    const text = String(line)
    const padded = text.length >= inner ? text : text.padEnd(inner)
    return `| ${padded} |`
  }).join('\n')
  return `${bar}\n${body}\n${bar}`
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
 * The logger gets only the ASCII summary — never the frame — so pino cannot
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
 * @param {object} logger
 * @param {string} detail
 */
function announcePhase (logger, detail) {
  const msg = `[local-content-sources] ${detail}`
  logger.warn(msg)
  try {
    process.stderr.write(msg + os.EOL)
  } catch {
    /* ignore */
  }
}

module.exports = {
  formatBanner,
  diskSearchSummary,
  buildDiskSearchLines,
  emitBanner,
  announceDiskSearchPlan,
  announcePhase,
}
