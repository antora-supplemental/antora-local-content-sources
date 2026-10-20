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
  statusForReportRow,
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

test('confirm html snapshot has the new copy, source list, and Yes/No', () => {
  const model = buildConfirmModel({
    missingCount: 1,
    total: 2,
    platform: 'win32',
    payload: {
      searchMethod: 'auto',
      sources: [
        { url: 'https://example.com/docs.git' },
        { url: 'https://example.com/already.git' },
      ],
    },
  })
  assert.equal(model.title, 'Antora Local content search')
  assert.equal(model.heading, 'Search for local Antora docs?')
  assert.equal(model.lead, 'Your Antora project sources its docs from online repositories. This build process will find local copies on your machine to use. If none are found, the build will download copies into a cache for fast rebuilds.')
  assert.equal(model.detail, 'This build process will search for .antora-source-id marker files to identify local clones of docs sources.')
  assert.equal(model.how, undefined)
  assert.equal(model.sources.length, 2)
  assert.equal(model.sources[0].status, 'waiting')
  assert.equal(model.sources[1].status, 'waiting')
  const html = renderConfirmHtml(model)
  assert.match(html, /<h1>Search for local Antora docs\?<\/h1>/)
  assert.match(html, /online repositories/)
  assert.match(html, /\.antora-source-id/)
  assert.match(html, /<h2>Scripting bypass<\/h2>/)
  assert.match(html, /<th>Remote URL<\/th><th>Status<\/th>/)
  assert.match(html, /https:\/\/example.com\/docs.git/)
  assert.match(html, /<td>waiting<\/td>/)
  assert.doesNotMatch(html, /<h2>How<\/h2>/)
  assert.doesNotMatch(html, /<h2>Why<\/h2>/)
  assert.doesNotMatch(html, /<h2>What<\/h2>/)
  assert.match(html, /<button type="button">Yes<\/button>/)
  assert.match(html, /<button type="button">No<\/button>/)
  assert.match(html, /ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH=yes/)
  assert.match(html, /ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH=no/)
  assert.match(html, /ANTORA_LOCAL_SOURCES_UI=tty/)
  assert.doesNotMatch(html, /[\u2014\u2026]/)
  const ps1 = fs.readFileSync(path.join(__dirname, '../lib/search-dialog.ps1'), 'utf8')
  for (const label of ['Scripting bypass', "Text = 'Yes'", "Text = 'No'", 'ListView', 'Details', 'RichTextBox', 'SelectionColor', 'Finished.', 'Finished with errors.', 'Antora Local content search']) {
    assert.equal(ps1.includes(label), true, label)
  }
  assert.equal(ps1.includes("Add-Block 'How'"), false)
  assert.equal([...ps1].every((ch) => ch.codePointAt(0) < 128), true)
})

test('report rows map to validated, found, or not found', () => {
  assert.equal(statusForReportRow({ localRoot: null, method: 'none' }), 'not found')
  assert.equal(statusForReportRow({ method: 'marker-search' }), 'not found')
  assert.equal(statusForReportRow({ localRoot: 'C:\\clone', method: 'cache' }), 'validated')
  assert.equal(statusForReportRow({ localRoot: 'C:\\clone', method: 'marker-search' }), 'found')
  assert.equal(statusForReportRow({ localRoot: 'C:\\clone', method: 'hive-heuristic' }), 'found')
  assert.equal(statusForReportRow({ localRoot: 'C:\\clone', method: 'first-match' }), 'found')
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
    assert.equal(launched.model.heading, 'Search for local Antora docs?')
    assert.equal(launched.model.how, undefined)
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
