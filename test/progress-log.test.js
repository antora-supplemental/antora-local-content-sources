'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  formatBanner,
  announceDiskSearchPlan,
  buildDiskSearchLines,
  BANNER_WIDTH,
} = require('../lib/progress-log')
const BOX = /[\u2500-\u257F\u2550-\u256C]/

test('formatBanner uses an ASCII frame and no box-drawing', () => {
  const banner = formatBanner(['Local content sources - disk search starting next', ''])
  assert.match(banner, /^-{72}$/m)
  assert.match(banner, /^\| Local content sources - disk search starting next/m)
  assert.equal([...banner].every((ch) => ch.codePointAt(0) < 128), true)
  assert.doesNotMatch(banner, BOX)
})

test('disk-search banner is written once to stderr; logger gets ASCII summary only', () => {
  const warns = []
  const chunks = []
  const orig = process.stderr.write
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk))
    return true
  }
  try {
    announceDiskSearchPlan({
      logger: { warn: (...args) => warns.push(args) },
      missingCount: 5,
      total: 5,
      payload: { searchMethod: 'walk', searchOtherDrives: false },
      willPrompt: true,
    })
  } finally {
    process.stderr.write = orig
  }

  assert.equal(warns.length, 1)
  const summary = warns[0].map(String).join(' ')
  assert.match(summary, /5 of 5 remote source\(s\)/)
  assert.doesNotMatch(summary, /remotesource/)
  assert.doesNotMatch(summary, BOX)
  assert.equal([...summary].every((ch) => ch.codePointAt(0) < 128), true)
  assert.equal(chunks.length, 1)
  const banner = chunks[0]
  assert.match(banner, /\| Local content sources - disk search starting next/)
  assert.match(banner, /5 of 5 remote source\(s\)/)
  assert.doesNotMatch(banner, /remotesource/)
  assert.doesNotMatch(banner, BOX)
  assert.equal([...banner].every((ch) => ch.codePointAt(0) < 128), true)
  assert.equal(summary.includes(banner.trim()), false)
  const lines = buildDiskSearchLines({
    missingCount: 5,
    total: 5,
    payload: { searchMethod: 'walk', searchOtherDrives: false },
    willPrompt: true,
  })
  assert.equal(banner.includes(formatBanner(lines)), true)
  for (const row of banner.trimEnd().split('\n')) {
    assert.equal(row.length, BANNER_WIDTH, row)
  }
})

test('formatBanner wraps long lines so the right border stays on the row', () => {
  const long = 'How: Windows NTFS MFT volume scan (can take several minutes per drive); scope: current volume + other drives.'
  const bypass = 'Scripting bypass: set ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH=yes to search without prompting, or ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH=no to skip search and use remote URLs only.'
  const banner = formatBanner([
    'Why: cached clone paths missing/invalid for 5 of 5 remote source(s).',
    long,
    bypass,
  ])
  const rows = banner.split('\n')
  assert.ok(rows.length > 5)
  for (const row of rows) assert.equal(row.length, BANNER_WIDTH, row)
  const body = rows.slice(1, -1)
  for (const row of body) {
    assert.equal(row.startsWith('| '), true)
    assert.equal(row.endsWith(' |'), true)
  }
  assert.match(banner, /remote source\(s\)/)
  assert.match(banner, /NTFS MFT volume scan/)
  assert.match(banner, /ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH=no/)
  assert.doesNotMatch(banner, /remotesource/)
  const narrow = formatBanner([long], 24)
  for (const row of narrow.split('\n')) assert.equal(row.length, 24, row)
})

test('disk-search banner content fits the default frame', () => {
  const lines = buildDiskSearchLines({
    missingCount: 5,
    total: 5,
    payload: { searchMethod: 'auto', searchOtherDrives: true },
    willPrompt: true,
  })
  const banner = formatBanner(lines)
  for (const row of banner.split('\n')) {
    assert.equal(row.length, BANNER_WIDTH, row)
  }
})
