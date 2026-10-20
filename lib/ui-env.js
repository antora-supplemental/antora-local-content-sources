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
 * True when this process is a Windows interactive desktop session.
 * CI, GitHub Actions, SSH, and service sessions are not desktops.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @returns {boolean}
 */
function desktopSessionAvailable (env, platform) {
  const e = env || {}
  if ((platform || process.platform) !== 'win32') return false
  if (e.CI === 'true' || e.CI === '1') return false
  if (e.GITHUB_ACTIONS === 'true') return false
  if (e.TF_BUILD === 'True' || e.TF_BUILD === 'true') return false
  if (e.GITLAB_CI || e.CIRCLECI === 'true' || e.BUILDKITE === 'true' || e.JENKINS_URL) return false
  if (e.SSH_CONNECTION || e.SSH_TTY) return false
  if (/^services$/i.test(String(e.SESSIONNAME || ''))) return false
  if (!e.USERPROFILE && !e.HOME) return false
  return true
}

module.exports = {
  UI_ENV,
  uiPreference,
  desktopSessionAvailable,
}
