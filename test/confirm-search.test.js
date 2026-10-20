'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { formatMarkerFile, markerIdForRemote, MARKER_BASENAME } = require('../lib/marker-id')
const { parseConfirmToken, diskSearchNeeded, confirmSearchPreflight, formatConfirmQuestion, runningInCi } = require('../lib/confirm-search')

test('confirm prompt keeps a space in remote source(s)', () => {
  const question = formatConfirmQuestion(5, 5)
  assert.match(question, /5 of 5 remote source\(s\)/)
  assert.doesNotMatch(question, /remotesource/)
})

test('parseConfirmToken accepts scripting bypass values', () => {
  assert.equal(parseConfirmToken('yes'), 'yes')
  assert.equal(parseConfirmToken('1'), 'yes')
  assert.equal(parseConfirmToken('no'), 'no')
  assert.equal(parseConfirmToken('0'), 'no')
})

test('diskSearchNeeded when cache empty', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-cf-'))
  const remote = 'https://github.com/dev-centr/docs.git'
  const r = diskSearchNeeded([{ url: remote }], path.join(tmp, 'missing-cache.json'))
  assert.equal(r.needed, true)
  assert.equal(r.missingCount, 1)
})

test('diskSearchNeeded false when cache valid', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-cf2-'))
  const repo = path.join(tmp, 'docs')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(path.join(repo, '.git'))
  const remote = 'https://github.com/dev-centr/docs.git'
  fs.writeFileSync(path.join(repo, MARKER_BASENAME), formatMarkerFile(remote))
  const markerId = markerIdForRemote(remote)
  const cachePath = path.join(tmp, 'cache.json')
  const mtimeMs = fs.statSync(path.join(repo, MARKER_BASENAME)).mtimeMs
  fs.writeFileSync(
    cachePath,
    JSON.stringify({ version: 2, entries: { [markerId]: { path: repo, mtimeMs } } })
  )
  const r = diskSearchNeeded([{ url: remote }], cachePath)
  assert.equal(r.needed, false)
})

test('non-TTY on a Windows desktop still prompts so a dialog can show', () => {
  assert.equal(confirmSearchPreflight({}, {
    env: { USERPROFILE: 'C:\\Users\\me', SESSIONNAME: 'Console' },
    stdinIsTTY: false,
    platform: 'win32',
  }), 'prompt')
})

test('non-TTY without a desktop still searches without a prompt', () => {
  assert.equal(confirmSearchPreflight({}, {
    env: { USERPROFILE: 'C:\\Users\\me', ANTORA_LOCAL_SOURCES_UI: 'tty' },
    stdinIsTTY: false,
    platform: 'win32',
  }), 'yes')
})

test('CI skips disk search even when confirm is yes', () => {
  for (const env of [
    { CI: 'true' },
    { CI: '1' },
    { GITHUB_ACTIONS: 'true' },
    { TF_BUILD: 'True' },
    { GITLAB_CI: 'true' },
    { CIRCLECI: 'true' },
    { BUILDKITE: 'true' },
    { JENKINS_URL: 'http://jenkins.example' },
  ]) {
    assert.equal(runningInCi(env), true, JSON.stringify(env))
    assert.equal(confirmSearchPreflight({}, {
      env: {
        ...env,
        USERPROFILE: 'C:\\Users\\me',
        SESSIONNAME: 'Console',
        ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'yes',
      },
      stdinIsTTY: true,
      platform: 'win32',
    }), 'no', JSON.stringify(env))
  }
  assert.equal(runningInCi({}), false)
  assert.equal(confirmSearchPreflight({}, {
    env: {
      USERPROFILE: 'C:\\Users\\me',
      SESSIONNAME: 'Console',
      ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'no',
    },
    stdinIsTTY: true,
    platform: 'win32',
  }), 'no')
})

test('confirm env bypass wins over a desktop session', () => {
  assert.equal(confirmSearchPreflight({}, {
    env: {
      USERPROFILE: 'C:\\Users\\me',
      SESSIONNAME: 'Console',
      ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'yes',
    },
    stdinIsTTY: true,
    platform: 'win32',
  }), 'yes')
  assert.equal(confirmSearchPreflight({}, {
    env: {
      USERPROFILE: 'C:\\Users\\me',
      ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'no',
    },
    stdinIsTTY: true,
    platform: 'win32',
  }), 'no')
})

test('confirmSearchPreflight respects env bypass', () => {
  const prev = process.env.ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH
  try {
    process.env.ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH = 'yes'
    assert.equal(confirmSearchPreflight({}), 'yes')
    process.env.ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH = 'no'
    assert.equal(confirmSearchPreflight({}), 'no')
  } finally {
    if (prev === undefined) delete process.env.ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH
    else process.env.ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH = prev
  }
})
