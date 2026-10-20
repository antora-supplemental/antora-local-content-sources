'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { confirmSearchPreflight } = require('../lib/confirm-search')
const {
  askToSearch,
  buildConfirmModel,
  renderConfirmHtml,
  resolveSearchChannel,
} = require('../lib/search-ui')

const desktopEnv = { USERPROFILE: 'C:\\Users\\me', SESSIONNAME: 'Console' }

function capture () {
  const warns = []
  const chunks = []
  return {
    warns,
    chunks,
    logger: { warn: (...args) => warns.push(args.map(String).join(' ')) },
    install () {
      const orig = process.stderr.write.bind(process.stderr)
      process.stderr.write = (chunk) => {
        chunks.push(String(chunk))
        return true
      }
      return () => {
        process.stderr.write = orig
      }
    },
  }
}

test('resolveSearchChannel keeps agents and CI on the shell', () => {
  const envYes = { ...desktopEnv, ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'yes' }
  assert.equal(resolveSearchChannel({
    preflight: confirmSearchPreflight({}, { env: envYes, stdinIsTTY: true, platform: 'win32' }),
    env: envYes,
    platform: 'win32',
  }), 'tty-progress')

  const ci = { ...desktopEnv, CI: 'true' }
  assert.equal(resolveSearchChannel({
    preflight: confirmSearchPreflight({}, { env: ci, stdinIsTTY: false, platform: 'win32' }),
    env: ci,
    platform: 'win32',
  }), 'tty-progress')

  const forced = { ...desktopEnv, ANTORA_LOCAL_SOURCES_UI: 'tty' }
  assert.equal(resolveSearchChannel({
    preflight: confirmSearchPreflight({}, { env: forced, stdinIsTTY: true, platform: 'win32' }),
    env: forced,
    platform: 'win32',
  }), 'tty-confirm')

  const skip = { ...desktopEnv, ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'no' }
  assert.equal(resolveSearchChannel({
    preflight: 'no',
    env: skip,
    platform: 'win32',
  }), 'skip')
})

test('resolveSearchChannel uses the dialog on a Windows desktop', () => {
  assert.equal(resolveSearchChannel({
    preflight: 'prompt',
    env: desktopEnv,
    platform: 'win32',
  }), 'gui-confirm')
  assert.equal(resolveSearchChannel({
    preflight: 'yes',
    env: desktopEnv,
    platform: 'linux',
  }), 'tty-progress')
})

test('confirm html snapshot has sections and Yes/No', () => {
  const html = renderConfirmHtml(buildConfirmModel({
    missingCount: 5,
    total: 5,
    platform: 'win32',
    payload: { searchMethod: 'auto', searchOtherDrives: true },
  }))
  assert.match(html, /<h2>Why<\/h2>/)
  assert.match(html, /<h2>What<\/h2>/)
  assert.match(html, /<h2>How<\/h2>/)
  assert.match(html, /<h2>Scripting bypass<\/h2>/)
  assert.match(html, /5 of 5 remote source\(s\)/)
  assert.match(html, /NTFS MFT/)
  assert.match(html, /Proceed with search\?/)
  assert.match(html, /<button type="button">Yes<\/button>/)
  assert.match(html, /<button type="button">No<\/button>/)
  assert.match(html, /ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH=yes/)
  assert.match(html, /ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH=no/)
  assert.match(html, /ANTORA_LOCAL_SOURCES_UI=tty/)
  assert.doesNotMatch(html, /[\u2014\u2026]/)
  const ps1 = fs.readFileSync(path.join(__dirname, '../lib/search-dialog.ps1'), 'utf8')
  for (const label of ['Why', 'What', 'How', 'Scripting bypass', "Text = 'Yes'", "Text = 'No'"]) {
    assert.equal(ps1.includes(label), true, label)
  }
  assert.equal([...ps1].every((ch) => ch.codePointAt(0) < 128), true)
})

test('desktop confirm uses the dialog and does not print the banner', () => {
  const cap = capture()
  const restore = cap.install()
  let launched = null
  try {
    const result = askToSearch({
      logger: cap.logger,
      missingCount: 2,
      total: 4,
      payload: { searchMethod: 'walk', searchOtherDrives: false },
      env: desktopEnv,
      platform: 'win32',
      stdinIsTTY: true,
      launch: (opts) => {
        launched = opts
        return {
          mode: 'gui',
          confirm: () => true,
          phase () {},
          finish () {},
        }
      },
    })
    assert.equal(result.proceed, true)
    assert.equal(result.sink.mode, 'gui')
    assert.equal(launched.mode, 'confirm')
    assert.match(launched.model.why, /2 of 4 remote source\(s\)/)
    assert.equal(cap.chunks.length, 0)
    assert.equal(cap.warns.length, 0)
  } finally {
    restore()
  }
})

test('CONFIRM=yes on a desktop stays on the shell and does not open a dialog', () => {
  const cap = capture()
  const restore = cap.install()
  let launched = false
  try {
    const result = askToSearch({
      logger: cap.logger,
      missingCount: 1,
      total: 1,
      payload: { searchMethod: 'walk', searchOtherDrives: false },
      env: { ...desktopEnv, ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'yes' },
      platform: 'win32',
      stdinIsTTY: true,
      readAnswer: () => {
        throw new Error('should not prompt')
      },
      launch: () => {
        launched = true
        throw new Error('should not launch')
      },
    })
    assert.equal(launched, false)
    assert.equal(result.proceed, true)
    assert.equal(result.sink, null)
    assert.equal(cap.chunks.length, 1)
    assert.match(cap.chunks[0], /disk search starting next/)
    assert.doesNotMatch(cap.chunks.join(''), /Proceed with search/)
  } finally {
    restore()
  }
})

test('dialog failure falls back to the terminal once', () => {
  const cap = capture()
  const restore = cap.install()
  try {
    const result = askToSearch({
      logger: cap.logger,
      missingCount: 1,
      total: 1,
      payload: { searchMethod: 'walk', searchOtherDrives: false },
      env: desktopEnv,
      platform: 'win32',
      stdinIsTTY: true,
      readAnswer: () => false,
      launch: () => {
        throw new Error('WinForms unavailable')
      },
    })
    assert.equal(result.proceed, false)
    assert.equal(cap.warns.filter((line) => line.includes('dialog could not start')).length, 1)
    assert.match(cap.warns.join('\n'), /WinForms unavailable/)
    assert.match(cap.chunks.join(''), /Proceed with search/)
  } finally {
    restore()
  }
})

test('UI=tty forces the shell prompt on a desktop', () => {
  const cap = capture()
  const restore = cap.install()
  let launched = false
  try {
    const result = askToSearch({
      logger: cap.logger,
      missingCount: 3,
      total: 3,
      payload: { searchMethod: 'walk', searchOtherDrives: false },
      env: { ...desktopEnv, ANTORA_LOCAL_SOURCES_UI: 'tty' },
      platform: 'win32',
      stdinIsTTY: true,
      readAnswer: () => true,
      launch: () => {
        launched = true
      },
    })
    assert.equal(launched, false)
    assert.equal(result.proceed, true)
    assert.match(cap.chunks.join(''), /Proceed with search\? \[Y\/n\]/)
    const summary = cap.warns.join('\n')
    assert.match(summary, /3 of 3 remote source\(s\)/)
    assert.equal([...summary].every((ch) => ch.codePointAt(0) < 128), true)
  } finally {
    restore()
  }
})

test('logger source strings in the extension stay ASCII', () => {
  const lib = path.join(__dirname, '../lib')
  for (const name of ['index.js', 'progress-log.js', 'confirm-search.js', 'search-ui.js']) {
    const text = fs.readFileSync(path.join(lib, name), 'utf8')
    assert.equal([...text].every((ch) => ch.codePointAt(0) < 128), true, name)
  }
  const index = fs.readFileSync(path.join(lib, 'index.js'), 'utf8')
  assert.match(index, /please wait/)
  assert.match(index, /elevated if/)
  assert.match(index, /github\.com\/\.\.\./)
  assert.doesNotMatch(index, /pleasewait/)
  assert.doesNotMatch(index, /elevatedif/)
})
