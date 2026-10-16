/**
 * Cloudflare Web Analytics: how many people come, from where, on what.
 *
 * No cookies, nothing stored on the visitor's device, so no consent banner.
 * The beacon reports the page address with the query and the hash stripped
 * (checked in its source, October 2026) — the hash is where a font's whole
 * recipe lives, and that never leaves the browser.
 *
 * Only on the live domain: a dev server, a preview build or a copy hosted
 * elsewhere would otherwise count as visits.
 */

const TOKEN = '91c67957e5fc488ea1833d088dc85346'
const HOST = 'forfontsake.xyz'

export function startAnalytics(): void {
  if (location.hostname !== HOST) return
  const s = document.createElement('script')
  s.defer = true
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  s.dataset.cfBeacon = JSON.stringify({ token: TOKEN })
  document.head.appendChild(s)
}
