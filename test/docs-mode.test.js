'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolveDocsMode, saveDocsMode } = require('../lib/docs-mode')

test('CI stays remote even when confirm and mode say local', () => {
  assert.equal(resolveDocsMode({
    env: { CI: 'true', ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'yes', ANTORA_LOCAL_SOURCES_MODE: 'local' },
  }), 'remote')
  assert.equal(resolveDocsMode({
    env: { GITHUB_ACTIONS: 'true', ANTORA_LOCAL_SOURCES_MODE: 'ask' },
  }), 'remote')
  assert.equal(resolveDocsMode({ env: { TF_BUILD: 'True' } }), 'remote')
  assert.equal(resolveDocsMode({ env: { GITLAB_CI: 'true' } }), 'remote')
})

test('confirm no is cache-only and yes scans on the shell', () => {
  assert.equal(resolveDocsMode({
    env: { ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'no' },
  }), 'cache-only')
  assert.equal(resolveDocsMode({
    env: { ANTORA_LOCAL_SOURCES_CONFIRM_SEARCH: 'yes' },
  }), 'local-shell')
})

test('MODE overrides the remembered path choice', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-mode-'))
  const cachePath = path.join(tmp, 'local-content-cache.json')
  saveDocsMode(cachePath, 'remote')
  assert.equal(resolveDocsMode({ env: {}, cachePath }), 'remote')
  assert.equal(resolveDocsMode({
    env: { ANTORA_LOCAL_SOURCES_MODE: 'ask' },
    cachePath,
  }), 'ask')
  assert.equal(resolveDocsMode({
    env: { ANTORA_LOCAL_SOURCES_MODE: 'local' },
    cachePath,
  }), 'local')
  const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  assert.equal(saved.ui.docsMode, 'remote')
  assert.deepEqual(saved.entries, {})
})
