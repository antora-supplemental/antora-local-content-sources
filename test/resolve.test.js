'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { markerBasenameForRemote, normalizeGitRemoteUrl } = require('../lib/marker-id')
const { resolveLocalSources } = require('../lib/resolve')

test('normalizeGitRemoteUrl collapses https and .git', () => {
  const a = normalizeGitRemoteUrl('https://github.com/dev-centr/docs.git')
  const b = normalizeGitRemoteUrl('git@github.com:dev-centr/docs.git')
  assert.equal(a, b)
})

test('marker basename is stable', () => {
  const m1 = markerBasenameForRemote('https://github.com/dev-centr/docs.git')
  const m2 = markerBasenameForRemote('https://github.com/dev-centr/docs')
  assert.equal(m1, m2)
  assert.match(m1, /^\.antora-src-[0-9a-f]{32}$/)
})

test('resolve finds marker file under search root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-'))
  const repo = path.join(tmp, 'github.com', 'dev-centr', 'docs')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(path.join(repo, '.git'))
  const remote = 'https://github.com/dev-centr/docs.git'
  const marker = markerBasenameForRemote(remote)
  fs.writeFileSync(path.join(repo, marker), remote + '\n')
  const cachePath = path.join(tmp, 'cache.json')
  const { resolved, report } = resolveLocalSources({
    sources: [{ url: remote, branches: 'HEAD', start_path: 'docs' }],
    searchRoots: [tmp],
    cachePath,
  })
  assert.equal(resolved[0].url, repo)
  assert.equal(resolved[0].worktrees, true)
  assert.equal(report[0].method, 'marker-search')
})
