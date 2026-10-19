// Custom Windows signing hook for electron-builder: Certum "Code Signing in the Cloud" (SimplySign).
// The GitHub release workflow logs SimplySign Desktop in and exports CERTUM_THUMBPRINT and SIGNTOOL_PATH;
// without them (local builds, pull requests) files are left unsigned on purpose.
const { execFileSync } = require('child_process')

const TIMESTAMP_URL = process.env.CERTUM_TIMESTAMP_URL || 'http://time.certum.pl'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

exports.default = async function sign(configuration) {
  const thumbprint = process.env.CERTUM_THUMBPRINT
  if (!thumbprint) return
  // SHA-256 only: SHA-1 Authenticode signatures are obsolete
  if (configuration.hash && configuration.hash !== 'sha256') return

  const args = ['sign', '/sha1', thumbprint, '/tr', TIMESTAMP_URL, '/td', 'SHA256', '/fd', 'SHA256']
  if (configuration.isNest) args.push('/as')
  args.push(configuration.path)

  // The cloud key and the timestamp server occasionally time out: retry a few times
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(process.env.SIGNTOOL_PATH || 'signtool.exe', args, { stdio: 'inherit' })
      return
    } catch (err) {
      if (attempt >= 3) throw err
      console.warn(`signtool failed (attempt ${attempt}), retrying in ${attempt * 10} s…`)
      await sleep(attempt * 10000)
    }
  }
}
