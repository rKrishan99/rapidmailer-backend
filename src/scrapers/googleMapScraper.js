import puppeteer from "puppeteer";

export async function scrapeGoogleMaps(query, location, maxResults = 100) {
    const browser = await puppeteer.launch({
        headless: false, // Set to true for production
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
        ],
        defaultViewport: null,
    });

    const page = await browser.newPage();

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
        console.error("Error waiting for selector: ", error);
        await browser.close();
        return { error: 'Failed to load the page properly' };
    }

    // Scroll to load more results
    for (let i = 0; i < 5; i++) {
        const previousHeight = await page.evaluate('document.body.scrollHeight');
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        
        try {
            await page.waitForFunction(
                `document.body.scrollHeight > ${previousHeight}`,
                { timeout: 5000 }
            );
        } catch (error) {
            console.log("No more content to load.");
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
                .find(el => el.textContent.includes('·'))?.nextSibling?.textContent.trim() || 'No Address';
            const rating = result.querySelector('.QBUL8c .MW4etd')?.textContent.trim() || 'No Rating';
            const category = result.querySelector('.W4Efsd span')?.textContent.trim() || 'No Category';
            const status = Array.from(result.querySelectorAll('.W4Efsd span'))
                .find(el => el.textContent.includes('Open'))?.textContent.trim() || 'No Status';

            businesses.push({ name, address, rating, category, status });
        });
        return businesses;
    });

    console.log("Extracted basic data:", extractedData);

    // Extract detailed data from the right panel
    for (const [index, result] of extractedData.entries()) {
        if (index >= maxResults) break; // Limit results

        // Skip results with invalid names
        if (result.name === 'No Name') {
            console.warn(`Skipping result with invalid name: ${result.name}`);
            continue;
        }

        // Click on the result using its aria-label
        const resultSelector = `.Nv2PK > a[aria-label="${result.name}"]`;
        try {
            await page.waitForSelector(resultSelector, { timeout: 30000 });
            await page.click(resultSelector);
        } catch (error) {
            console.error(`Failed to click result "${result.name}":`, error);
            continue; // Skip this result
        }

        // Wait for the right panel to load
        try {
            await page.waitForSelector('.RcCsl', { timeout: 30000 });
        } catch (error) {
            console.error("Right panel failed to load:", error);
            continue; // Skip this result
        }

        // Extract detailed information
        const detailedInfo = await page.evaluate(() => {
            const name = document.querySelector('h1.DUwDvf.lfPIob')?.textContent.trim() || 'No Name';
            const rating = document.querySelector('.F7nice span[aria-hidden="true"]')?.textContent.trim() || 'No Rating';
            const reviews = document.querySelector('.F7nice span[aria-label^="Rated"]')?.textContent.trim() || 'No Reviews';
            const category = document.querySelector('button.DkEaL')?.textContent.trim() || 'No Category';
            const website = Array.from(document.querySelectorAll('div.Io6YTe.fontBodyMedium.kR99db.fdkmkc'))
                .find(el => el.textContent.includes('.'))?.textContent.trim() || 'No Website';
            const phone = Array.from(document.querySelectorAll('div.Io6YTe.fontBodyMedium.kR99db.fdkmkc'))
                .find(el => el.textContent.startsWith('+'))?.textContent.trim() || 'No Phone';

            return { name, rating, reviews, category, website, phone };
        });

        // Add detailed info to the result
        extractedData[index] = { ...extractedData[index], ...detailedInfo };

        // Close the right panel to prepare for the next result
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for the panel to close
    }

    console.log("Extracted detailed data:", extractedData);

    await browser.close();

    // Deduplicate results
    const uniqueBusinesses = Array.from(new Map(extractedData.map(b => [b.name, b])).values());

    console.log(`Extracted ${uniqueBusinesses.length} unique businesses.`);
    return uniqueBusinesses.slice(0, maxResults);
}