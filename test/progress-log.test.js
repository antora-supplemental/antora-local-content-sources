'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  formatBanner,
  announceDiskSearchPlan,
  buildDiskSearchLines,
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
})
