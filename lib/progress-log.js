'use strict'

const os = require('node:os')
const { BYPASS_HINT, ENV_CONFIRM } = require('./confirm-search')
const { MARKER_BASENAME } = require('./marker-id')

/**
 * @param {object} logger Antora logger
 * @param {string[]} lines
 */
function emitBanner (logger, lines) {
  const width = 72
  const bar = '─'.repeat(width)
  const body = lines.map((l) => `│ ${l.padEnd(width - 2)} │`).join('\n')
  const block = `${bar}\n${body}\n${bar}`
  logger.warn(block)
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
function announceDiskSearchPlan ({ logger, missingCount, total, payload, willPrompt }) {
  const searchMethod = payload.searchMethod || 'auto'
  const mft =
    process.platform === 'win32' && searchMethod !== 'walk'
      ? 'Windows NTFS MFT volume scan (can take several minutes per drive)'
      : 'directory walks on configured drives/roots'
  const drives =
    payload.searchOtherDrives !== false
      ? 'current volume + other drives'
      : 'current volume only'
  const lines = [
    'Local content sources — disk search starting next',
    '',
    `Why: cached clone paths missing/invalid for ${missingCount}/${total} remote(s).`,
    `What: find ${MARKER_BASENAME} markers, then read id/url inside each file.`,
    `How: ${mft}; scope: ${drives}.`,
    '',
    willPrompt
      ? 'Waiting for your confirmation below (or enter Y).'
      : `Non-interactive or ${ENV_CONFIRM}=yes — proceeding without prompt.`,
    BYPASS_HINT,
  ]
  emitBanner(logger, lines)
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
  emitBanner,
  announceDiskSearchPlan,
  announcePhase,
}
