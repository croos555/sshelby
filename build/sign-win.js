// Custom Windows signing hook for electron-builder: Certum "Code Signing in the Cloud" (SimplySign)
// through ssign (https://github.com/Le-Syl21/ssign), which talks to Certum's cloud API over HTTPS
// (no SimplySign Desktop, no virtual smart card), from Linux in the release workflow, which provides ssign plus
// CERTUM_EMAIL / CERTUM_OTP; without them (local builds, pull requests) files are left unsigned on purpose.
const { execFileSync } = require('child_process')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

exports.default = async function sign(configuration) {
  if (!process.env.CERTUM_OTP || !process.env.CERTUM_EMAIL) return
  // SHA-256 only: SHA-1 Authenticode signatures are obsolete
  if (configuration.hash && configuration.hash !== 'sha256') return

  // ssign signs in place with SHA-256, embeds the Certum chain and adds an RFC 3161 timestamp.
  // It caches the cloud session for 20 minutes, so all files share one login.
  // The cloud and the timestamp server occasionally time out: retry a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(process.env.SSIGN_PATH || 'ssign', [configuration.path], { stdio: 'inherit' })
      return
    } catch (err) {
      if (attempt >= 3) throw err
      console.warn(`ssign failed (attempt ${attempt}), retrying in ${attempt * 10} s…`)
      await sleep(attempt * 10000)
    }
  }
}
