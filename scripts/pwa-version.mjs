/**
 * scripts/pwa-version.mjs
 * Stamps the PWA shell cache name in frontend/pwa/sw.js with a hash of the
 * content of every precached shell asset, so any change to a shipped file
 * produces a new service worker version without a manual bump.
 *
 *   node scripts/pwa-version.mjs           write the stamp
 *   node scripts/pwa-version.mjs --check   exit 1 if the stamp is stale
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PWA_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../frontend/pwa')
const SW_PATH = path.join(PWA_ROOT, 'sw.js')
const STAMP = /const SHELL_CACHE\s*=\s*'[^']*'/

export function shellAssets (swSource) {
  const list = swSource.match(/const SHELL_ASSETS = \[([\s\S]*?)\]/)
  if (!list) throw new Error('sw.js: SHELL_ASSETS not found')
  return [...list[1].matchAll(/'([^']+)'/g)].map(match => match[1])
}

export function shellVersion (swSource) {
  const hash = createHash('sha256')
  for (const asset of shellAssets(swSource)) {
    const file = path.join(PWA_ROOT, asset === '/' ? 'index.html' : asset)
    hash.update(asset).update('\0').update(fs.readFileSync(file)).update('\0')
  }
  return `fieldops-shell-${hash.digest('hex').slice(0, 12)}`
}

export function stampedSource (swSource) {
  if (!STAMP.test(swSource)) throw new Error('sw.js: SHELL_CACHE not found')
  return swSource.replace(STAMP, `const SHELL_CACHE  = '${shellVersion(swSource)}'`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = fs.readFileSync(SW_PATH, 'utf8')
  const stamped = stampedSource(source)
  if (process.argv.includes('--check')) {
    if (stamped !== source) {
      console.error('frontend/pwa/sw.js shell version is stale. Run: npm run pwa:version')
      process.exit(1)
    }
  } else if (stamped !== source) {
    fs.writeFileSync(SW_PATH, stamped)
    console.log(`sw.js stamped: ${shellVersion(source)}`)
  }
}
