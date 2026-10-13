import puppeteer from "puppeteer";
import { getSettings } from "../config/settingsStore.js";
import { trackBrowser, untrackBrowser, isMissingBrowserError } from "../utils/browserRegistry.js";

export async function scrapeGoogleMaps(query, location, maxResults = 100) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: getSettings().scraping.puppeteerHeadless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--blink-settings=imagesEnabled=false', // belt-and-braces image suppression
            ],
            defaultViewport: null,
        });
    } catch (err) {
        if (isMissingBrowserError(err)) {
            throw new Error('SCRAPER_ENGINE_MISSING');
        }
        throw err;
    }
    trackBrowser(browser);

    try {
        const page = await browser.newPage();

        // Block heavyweight resource types — images, CSS, fonts, media.
        // Typically cuts page memory by 60-70% and speeds up scraping significantly.
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Set a realistic user-agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');

        const searchQuery = `${query} in ${location}`;
        const encodedSearchQuery = encodeURIComponent(searchQuery);
        const url = `https://www.google.com/maps/search/${encodedSearchQuery}`;

        console.log(`🔍 Searching: ${searchQuery}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        try {
            await page.waitForSelector('.Nv2PK', { timeout: 30000 });
            console.log("Page loaded successfully.");
        } catch (error) {
            console.error("Error waiting for selector:", error.message);
            return { error: 'Failed to load the page properly' };
        }

        // Scroll to load more results. 5 attempts used to cut this off way
        // before Google's own local-pack ceiling (~100-120 results) — bulk
        // searches were silently truncated to whatever loaded in the first
        // few scrolls. 25 attempts is enough to actually reach that ceiling
        // for a big city + broad keyword; it still exits fast (a few
        // seconds) for a smaller city that runs out sooner, and stops as
        // soon as we already have enough for the requested maxResults so a
        // small request doesn't scroll further than it needs to.
        const MAX_SCROLL_ATTEMPTS = 30;
        for (let i = 0; i < MAX_SCROLL_ATTEMPTS; i++) {
            const loadedCount = await page.evaluate(() => document.querySelectorAll('.Nv2PK').length);
            if (loadedCount >= maxResults) {
                console.log(`Loaded ${loadedCount} results, which covers the requested ${maxResults} — stopping scroll.`);
                break;
            }

            const previousHeight = await page.evaluate('document.body.scrollHeight');
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');

            try {
                await page.waitForFunction(
                    `document.body.scrollHeight > ${previousHeight}`,
                    { timeout: 5000 }
                );
            } catch (error) {
                console.log("No more content to load — reached Google's own end of the list for this search.");
                break;
            }
        }

        // Extract basic data from the left sidebar
        let extractedData = await page.evaluate(() => {
            const businesses = [];
            document.querySelectorAll('.Nv2PK').forEach(result => {
                const name = result.querySelector('.qBF1Pd.fontBodyMedium .fontHeadlineSmall')?.textContent.trim() ||
                             result.querySelector('.fontHeadlineSmall')?.textContent.trim() || 'No Name';
                const address = Array.from(result.querySelectorAll('.W4Efsd span'))
                    .find(el => el.textContent.includes('·'))?.nextSibling?.textContent.replace(/^[\s·⋅]+/, '').trim() || 'No Address';
                // Rating + review count live in an aria-label like "4.7 stars 193 Reviews".
                const ratingLabel = result.querySelector('span[role="img"][aria-label]')?.getAttribute('aria-label') || '';
                const ratingMatch = ratingLabel.match(/([0-5](?:\.\d)?)\s*stars?\s*([\d,]+)?/i);
                const rating = ratingMatch?.[1] || result.querySelector('.MW4etd')?.textContent.trim() || 'No Rating';
                const reviews = ratingMatch?.[2] || '';
                // Category = first text span in the info rows that isn't the rating,
                // an address fragment, or an open/closed status.
                const category = Array.from(result.querySelectorAll('.W4Efsd span'))
                    .map(el => el.textContent.trim())
                    .find(t => t && !/^[0-5](\.\d)?\s*\(/.test(t) && !/^\(?[\d,]+\)?$/.test(t)
                        && !/^[·⋅]$/.test(t) && !/^(open|closed|opens|closes)/i.test(t)
                        && !/\d/.test(t)) || 'No Category';
                const cardPhone = result.querySelector('.UsdlK')?.textContent.trim() || '';
                const status = Array.from(result.querySelectorAll('.W4Efsd span'))
                    .find(el => el.textContent.includes('Open'))?.textContent.trim() || 'No Status';
                // The result card in the left list shows a "Website" button when
                // Google has a site for the business. Capture it now as a second
                // source that doesn't depend on the detail panel loading.
                const cardWebsite = result.querySelector('a[data-value="Website"]')?.href || '';

                businesses.push({ name, address, rating, reviews, category, status, cardWebsite, cardPhone });
            });
            return businesses;
        });

        console.log("Extracted basic data:", extractedData.length, "results");

        // Extract detailed data from the right panel
        for (const [index, result] of extractedData.entries()) {
            if (index >= maxResults) break; // Limit results

            // Skip results with invalid names
            if (result.name === 'No Name') {
                console.warn(`Skipping result with invalid name: ${result.name}`);
                continue;
            }

            let panelReady = false;
            let clickFailed = false;
            // Two attempts: the panel occasionally fails to open on the first click.
            for (let attempt = 0; attempt < 2 && !panelReady; attempt++) {
                clickFailed = false;
                // Click the result by its position in the list (aria-label selectors
                // break on names containing quotes and on duplicate names).
                try {
                    // Real (puppeteer) mouse click, like the original code used —
                    // an in-page element.click() doesn't always open the panel.
                    const cards = await page.$$('.Nv2PK');
                    const card = cards[index];
                    const link = card && ((await card.$('a.hfpxzc')) || (await card.$('a')));
                    if (!link) throw new Error('result link not found');
                    await link.evaluate((el) => el.scrollIntoView({ block: 'center' }));
                    await link.click();
                } catch (error) {
                    console.error(`Failed to click result "${result.name}":`, error.message);
                    clickFailed = true;
                }

                if (clickFailed) continue;

                // Wait until the detail panel is actually showing THIS business.
                // Previously we only waited for '.RcCsl', which can still be on the
                // page from the previous result, so details could be read too early
                // (stale or empty) and websites came back as "No Website".
                try {
                    await page.waitForFunction(
                        (expected) => {
                            const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                            const want = norm(expected);
                            const candidates = [
                                document.querySelector('h1.DUwDvf')?.textContent,
                                ...Array.from(document.querySelectorAll('div[role="main"][aria-label]'))
                                    .map((el) => el.getAttribute('aria-label')),
                            ];
                            return candidates.some((c) => {
                                const got = norm(c);
                                return !!got && !!want && (got === want || got.includes(want) || want.includes(got));
                            });
                        },
                        { timeout: 15000 },
                        result.name
                    );
                    panelReady = true;
                    // give the lazily-rendered action rows (website/phone) a moment
                    await page.waitForSelector(
                        'a[data-item-id="authority"], button[data-item-id^="phone:tel:"], button[data-item-id="address"]',
                        { timeout: 4000 }
                    ).catch(() => {});
                } catch (error) {
                    console.error(`Detail panel did not load for "${result.name}":`, error.message);
                }

            }
            if (clickFailed) {
                // Couldn't open this result at all: we don't know its website status.
                extractedData[index] = { ...extractedData[index], website: 'Unknown', hasWebsite: null, websiteType: 'unknown' };
                continue;
            }

            // Extract detailed information
            const detailedInfo = panelReady ? await page.evaluate(() => {
                const name = document.querySelector('h1.DUwDvf.lfPIob')?.textContent.trim()
                    || document.querySelector('h1.DUwDvf')?.textContent.trim()
                    || document.querySelector('div[role="main"][aria-label]')?.getAttribute('aria-label') || 'No Name';
                const rating = document.querySelector('.F7nice span[aria-hidden="true"]')?.textContent.trim() || 'No Rating';
                const reviews = document.querySelector('.F7nice span[aria-label^="Rated"]')?.textContent.trim() || 'No Reviews';
                const category = document.querySelector('button.DkEaL')?.textContent.trim() || 'No Category';

                // Stable selectors: Google's data-item-id attributes survive the
                // obfuscated class-name changes that broke the old selector.
                const siteEl = document.querySelector('a[data-item-id="authority"]');
                const websiteHref = siteEl?.href || '';

                const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"]');
                const phone = phoneEl
                    ? (phoneEl.getAttribute('data-item-id').replace('phone:tel:', '')
                        || phoneEl.getAttribute('aria-label')?.replace(/^Phone:\s*/i, '').trim() || '')
                    : '';

                const addrEl = document.querySelector('button[data-item-id="address"]');
                const fullAddress = addrEl?.getAttribute('aria-label')?.replace(/^Address:\s*/i, '').trim() || '';

                return { name, rating, reviews, category, websiteHref, phone, fullAddress, panelLoaded: true };
            }) : { panelLoaded: false };

            // Decide the website verdict in one place.
            const SOCIAL_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'linktr.ee', 'tiktok.com',
                'twitter.com', 'x.com', 'youtube.com', 'yelp.com', 'business.site', 'wixsite.com', 'sites.google.com'];
            const isSocialOnly = (u) => {
                try {
                    const host = new URL(u).hostname.replace(/^www\./, '').toLowerCase();
                    return SOCIAL_HOSTS.some((h) => host === h || host.endsWith('.' + h));
                } catch (_) { return false; }
            };
            // Google wraps outbound links as https://www.google.com/url?q=<real url>&...
            // Unwrap them and drop tracking params so we store the clean site.
            const cleanUrl = (u) => {
                try {
                    let url = new URL(u);
                    if (/(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === '/url') {
                        const q = url.searchParams.get('q') || url.searchParams.get('url');
                        if (!q) return '';
                        url = new URL(q);
                    }
                    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']
                        .forEach((k) => url.searchParams.delete(k));
                    return url.toString();
                } catch (_) { return ''; }
            };
            const rawSite = cleanUrl((detailedInfo.websiteHref || result.cardWebsite || '').trim());
            let website, hasWebsite, websiteType;
            if (rawSite) {
                website = rawSite;
                if (isSocialOnly(rawSite)) { website = 'No Website'; detailedInfo.socialUrl = rawSite; hasWebsite = false; websiteType = 'social-only'; }
                else { hasWebsite = true; websiteType = 'own-site'; }
            } else if (detailedInfo.panelLoaded) {
                website = 'No Website'; hasWebsite = false; websiteType = 'none';
            } else {
                // Panel never loaded and the list card had no site: we do NOT
                // know. Don't claim "No Website" — flag it for a re-check.
                website = 'Unknown'; hasWebsite = null; websiteType = 'unknown';
            }
            delete detailedInfo.websiteHref;
            delete detailedInfo.panelLoaded;
            detailedInfo.website = website;
            detailedInfo.hasWebsite = hasWebsite;
            detailedInfo.websiteType = websiteType;
            if (!detailedInfo.phone && result.cardPhone) detailedInfo.phone = result.cardPhone;
            if (!detailedInfo.phone) delete detailedInfo.phone;
            if (!detailedInfo.fullAddress) delete detailedInfo.fullAddress;

            // Add detailed info to the result
            extractedData[index] = { ...extractedData[index], ...detailedInfo };
            delete extractedData[index].cardWebsite;
            delete extractedData[index].cardPhone;

            // Close the right panel to prepare for the next result
            await page.keyboard.press('Escape');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for the panel to close
        }

        console.log("Extracted detailed data for", extractedData.length, "results");

        // Deduplicate results
        const uniqueBusinesses = Array.from(new Map(extractedData.map(b => [b.name, b])).values());

        console.log(`Extracted ${uniqueBusinesses.length} unique businesses.`);
        return uniqueBusinesses.slice(0, maxResults);
    } finally {
        untrackBrowser(browser);
        await browser.close().catch(() => {});
    }
}
