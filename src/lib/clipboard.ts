/**
 * Put text on the clipboard, by whichever route the browser allows.
 *
 * The async Clipboard API is the right one and is what runs nearly always. It
 * is also refused outright in more places than you would expect — a denied
 * permission, an iframe without the policy, a browser that only grants it to a
 * real gesture — and "the browser would not let us" is a useless thing to tell
 * somebody who just wants their SVG. The old selection-and-execCommand route
 * needs no permission at all, so it stands behind the new one as the fallback
 * rather than being replaced by it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through to the legacy route
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    // off-screen but still selectable: display:none or hidden would not be
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
