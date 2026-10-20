'use strict'

/** Force the ASCII terminal banner and phase lines. `shell` and `ascii` are aliases. */
const UI_ENV = 'ANTORA_LOCAL_SOURCES_UI'

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'tty' | 'gui' | 'auto'}
 */
function uiPreference (env) {
  const v = String((env && env[UI_ENV]) || '').trim().toLowerCase()
  if (v === 'tty' || v === 'shell' || v === 'ascii') return 'tty'
  if (v === 'gui' || v === 'dialog') return 'gui'
  return 'auto'
}

/**
 * True in CI. These runs must not scan the local disk for clones.
 * Covers the mode:auto check (`CI`, `GITHUB_ACTIONS`) plus Azure, GitLab,
 * Circle, Buildkite, and Jenkins.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function runningInCi (env) {
  const e = env || {}
  if (e.CI === 'true' || e.CI === '1') return true
  if (e.GITHUB_ACTIONS === 'true') return true
  if (e.TF_BUILD === 'True' || e.TF_BUILD === 'true') return true
  if (e.GITLAB_CI) return true
  if (e.CIRCLECI === 'true' || e.BUILDKITE === 'true' || e.JENKINS_URL) return true
  return false
}

/**
 * True when this process is a Windows interactive desktop session.
 * CI, GitHub Actions, SSH, and service sessions are not desktops.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @returns {boolean}
 */
function desktopSessionAvailable (env, platform) {
  const e = env || {}
  if ((platform || process.platform) !== 'win32') return false
  if (runningInCi(e)) return false
  if (e.SSH_CONNECTION || e.SSH_TTY) return false
  if (/^services$/i.test(String(e.SESSIONNAME || ''))) return false
  if (!e.USERPROFILE && !e.HOME) return false
  return true
}

module.exports = {
  UI_ENV,
  uiPreference,
  runningInCi,
  desktopSessionAvailable,
}
