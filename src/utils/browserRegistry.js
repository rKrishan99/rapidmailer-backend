// Tracks every Puppeteer browser currently open across all scrapers, so the
// app can force-close them on shutdown (SIGTERM/SIGINT/uncaughtException).
// Without this, a scrape in progress when the desktop app is force-quit
// could leave an orphaned Chromium process running in the background.
const activeBrowsers = new Set();

export function trackBrowser(browser) {
  activeBrowsers.add(browser);
  return browser;
}

export function untrackBrowser(browser) {
  activeBrowsers.delete(browser);
}

export async function closeAllTrackedBrowsers() {
  const browsers = Array.from(activeBrowsers);
  activeBrowsers.clear();
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
}

// Puppeteer's own error message when the Chromium binary it expects isn't
// present on disk — distinguishable so routes can return an actionable
// "not installed" message instead of a generic scrape-failure error.
export function isMissingBrowserError(err) {
  return /Could not find (Chrome|Chromium)|Failed to launch the browser process/i.test(
    err?.message || ""
  );
}
