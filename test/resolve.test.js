'use strict'

process.env.ANTORA_LOCAL_SOURCES_SEARCH_DRIVES = '0'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  markerIdForRemote,
  normalizeGitRemoteUrl,
  formatMarkerFile,
  MARKER_BASENAME,
} = require('../lib/marker-id')
const { resolveLocalSources, resolveLocalSourcesAsync } = require('../lib/resolve')
const { pickOverridePath, loadPathOverrides } = require('../lib/overrides')
const { searchUpwardFrom } = require('../lib/search')

test('normalizeGitRemoteUrl collapses https and .git', () => {
  const a = normalizeGitRemoteUrl('https://github.com/dev-centr/docs.git')
  const b = normalizeGitRemoteUrl('git@github.com:dev-centr/docs.git')
  assert.equal(a, b)
})

test('marker id is stable 32 hex', () => {
  const m1 = markerIdForRemote('https://github.com/dev-centr/docs.git')
  const m2 = markerIdForRemote('https://github.com/dev-centr/docs')
  assert.equal(m1, m2)
  assert.match(m1, /^[0-9a-f]{32}$/)
})

test('resolve finds marker file under search root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-'))
  const repo = path.join(tmp, 'github.com', 'dev-centr', 'docs')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(path.join(repo, '.git'))
  const remote = 'https://github.com/dev-centr/docs.git'
  fs.writeFileSync(path.join(repo, MARKER_BASENAME), formatMarkerFile(remote))
  const cachePath = path.join(tmp, 'cache.json')
  const { resolved, report } = resolveLocalSources({
    sources: [{ url: remote, branches: 'HEAD', start_path: 'docs' }],
    searchRoots: [tmp],
    startDir: tmp,
    cachePath,
    searchOtherDrives: false,
    maxUpwardHops: 0,
  })
  assert.equal(resolved[0].url, repo)
  assert.equal(resolved[0].worktrees, true)
  assert.equal(report[0].method, 'marker-search')
  assert.equal(report[0].markerId, markerIdForRemote(remote))
})

test('upward search finds clone in parent directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-up-'))
  const repo = path.join(tmp, 'clone')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(path.join(repo, '.git'))
  const remote = 'https://github.com/dev-centr/docs.git'
  fs.writeFileSync(path.join(repo, MARKER_BASENAME), formatMarkerFile(remote))
  const nested = path.join(tmp, 'playbook', 'hub')
  fs.mkdirSync(nested, { recursive: true })
  const hits = searchUpwardFrom(nested, MARKER_BASENAME, 5, 4)
  assert.ok(hits.some((h) => path.resolve(h) === path.resolve(path.join(repo, MARKER_BASENAME))))
})

test('duplicate clones report conflict and override selects path', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-dup-'))
  const remote = 'https://github.com/dev-centr/docs.git'
  const repoA = path.join(tmp, 'a', 'docs')
  const repoB = path.join(tmp, 'b', 'docs')
  for (const repo of [repoA, repoB]) {
    fs.mkdirSync(repo, { recursive: true })
    fs.mkdirSync(path.join(repo, '.git'))
    fs.writeFileSync(path.join(repo, MARKER_BASENAME), formatMarkerFile(remote))
  }
  const markerId = markerIdForRemote(remote)
  const overridesFile = path.join(tmp, '.antora-local-sources.yml')
  fs.writeFileSync(
    overridesFile,
    `sources:\n  ${markerId}:\n    path: ${JSON.stringify(repoB)}\n`
  )
  const overrides = loadPathOverrides([overridesFile])
  assert.equal(pickOverridePath(overrides, normalizeGitRemoteUrl(remote), markerId), path.resolve(repoB))

  const { report } = await resolveLocalSourcesAsync({
    sources: [{ url: remote }],
    searchRoots: [tmp],
    startDir: tmp,
    cachePath: path.join(tmp, 'cache.json'),
    searchOtherDrives: false,
    maxUpwardHops: 0,
    overrides,
  })
  assert.equal(report[0].conflict, false)
  assert.equal(report[0].overrideUsed, true)
  assert.equal(path.resolve(report[0].localRoot), path.resolve(repoB))
})

test('duplicate clones without override set conflict flag', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-dup2-'))
  const remote = 'https://github.com/dev-centr/docs.git'
  const repoA = path.join(tmp, 'a', 'docs')
  const repoB = path.join(tmp, 'b', 'docs')
  for (const repo of [repoA, repoB]) {
    fs.mkdirSync(repo, { recursive: true })
    fs.mkdirSync(path.join(repo, '.git'))
    fs.writeFileSync(path.join(repo, MARKER_BASENAME), formatMarkerFile(remote))
  }
  const { report } = await resolveLocalSourcesAsync({
    sources: [{ url: remote }],
    searchRoots: [tmp],
    startDir: tmp,
    cachePath: path.join(tmp, 'cache2.json'),
    searchOtherDrives: false,
    maxUpwardHops: 0,
  })
  assert.equal(report[0].matches.length, 2)
  assert.equal(report[0].conflict, true)
  assert.equal(report[0].method, 'first-match')
})
