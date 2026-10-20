'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MARKER_BASENAME } = require('../lib/marker-id')
const {
  acquireSource,
  antoraCloneFolderName,
  dedicatedRepoDir,
  findAntoraClone,
} = require('../lib/acquire-source')

const url = 'https://github.com/example/widget.git'

function gitRepo (dir) {
  fs.mkdirSync(dir, { recursive: true })
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
  const run = (args) => spawnSync('git', args, { cwd: dir, env, encoding: 'utf8', windowsHide: true })
  assert.equal(run(['init']).status, 0)
  fs.writeFileSync(path.join(dir, 'README'), 'docs\n')
  assert.equal(run(['add', 'README']).status, 0)
  assert.equal(run(['commit', '-m', 'init']).status, 0)
}

test('dedicated folder follows the hive of the playbook', () => {
  const playbook = 'C:\\code\\github.com\\dev-centr\\docs'
  const dest = dedicatedRepoDir(playbook, url, {})
  assert.equal(dest, path.join('C:\\code', 'github.com', 'example', 'widget'))
})

test('acquire refuses a non-empty directory that is not this repo', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-acq-'))
  const playbook = path.join(tmp, 'code', 'github.com', 'dev-centr', 'docs')
  fs.mkdirSync(playbook, { recursive: true })
  const dest = dedicatedRepoDir(playbook, url, {})
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'keep.txt'), 'keep')
  const result = acquireSource({
    url,
    playbookDir: playbook,
    antoraContentCache: path.join(tmp, 'missing-cache'),
    env: {},
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'error')
  assert.equal(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'keep')
})

test('acquire clones an Antora cache repo into the hive and writes the marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antora-lcs-move-'))
  const playbook = path.join(tmp, 'code', 'github.com', 'dev-centr', 'docs')
  fs.mkdirSync(playbook, { recursive: true })
  const cache = path.join(tmp, 'antora', 'content')
  const cached = path.join(cache, antoraCloneFolderName(url))
  gitRepo(cached)
  assert.equal(findAntoraClone(cache, url), cached)
  const result = acquireSource({
    url,
    playbookDir: playbook,
    antoraContentCache: cache,
    env: {},
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'validated')
  const marker = fs.readFileSync(path.join(result.path, MARKER_BASENAME), 'utf8')
  assert.match(marker, /url: https:\/\/github.com\/example\/widget/)
  assert.equal(fs.existsSync(cached), false)
  assert.equal(fs.existsSync(path.join(result.path, 'README')), true)
})
