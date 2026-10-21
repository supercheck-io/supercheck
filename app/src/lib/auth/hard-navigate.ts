/**
 * Leaves the single-page app for `url`. Used where the destination answers with
 * its own redirect (the OAuth authorize endpoint), which the client router
 * cannot follow. A thin wrapper so tests can replace it; jsdom does not let a
 * test redefine `window.location`.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
