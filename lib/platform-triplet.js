'use strict'

/**
 * Release asset triplet for antora-source-resolver GitHub builds.
 * @returns {string}
 */
function localResolverTriplet () {
  const plat = process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (plat === 'win32') return `windows-${arch}`
  if (plat === 'darwin') return `macos-${arch}`
  return `linux-${arch}`
}

/**
 * @param {string} triplet
 * @returns {{ archiveExt: '.zip' | '.tar.gz', binaryName: string }}
 */
function resolverReleaseAssetInfo (triplet) {
  if (triplet.startsWith('windows-')) {
    return { archiveExt: '.zip', binaryName: 'antora-source-resolver.exe' }
  }
  return { archiveExt: '.tar.gz', binaryName: 'antora-source-resolver' }
}

module.exports = { localResolverTriplet, resolverReleaseAssetInfo }
