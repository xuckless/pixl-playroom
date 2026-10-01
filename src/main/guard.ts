/**
 * Who may talk to the main process, and where a link may take the user.
 * The window only ever shows the app's own page; anything else (a frame that
 * navigated away, an injected iframe) is refused every IPC call, and links
 * open in the browser only when they lead to our own sites or the checkout.
 * Free of Electron, so tests/guard.test.ts can run it.
 */

/**
 * A test for "is this the app's own page": the packaged file (any hash or
 * query on it), or the dev server's origin under `pnpm dev`.
 */
export function appPage(pageFile: string, devUrl?: string): (url: string | undefined) => boolean {
  const dev = devUrl ? new URL(devUrl).origin : undefined
  const file = new URL(pageFile)
  return (url) => {
    if (!url) return false
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return false
    }
    if (dev) return u.origin === dev
    return u.protocol === 'file:' && u.host === file.host && u.pathname === file.pathname
  }
}

/** Hosts a link may open in the browser: our sites and their subdomains, and the checkout. */
const EXTERNAL_HOSTS = ['pixlfoundation.com', 'lemonsqueezy.com']

export function externalAllowed(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const host = u.hostname.toLowerCase()
  return EXTERNAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}
