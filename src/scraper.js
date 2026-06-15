const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

async function scrapeJobPage(url) {
  const browser = await puppeteerExtra.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Give dynamic content time to render
    await new Promise(r => setTimeout(r, 3000));

    // If LinkedIn redirected us to an auth wall, detect it by URL
    const finalUrl = page.url();
    if (/authwall|login|signin|checkpoint/i.test(finalUrl)) {
      throw new Error('LOGIN_WALL');
    }

    // Try to get LinkedIn-specific structured fields first
    const linkedInData = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
      return {
        title:       getText('.top-card-layout__title') || getText('h1'),
        company:     getText('.topcard__org-name-link') || getText('.top-card-layout__card .topcard__flavor--black-link'),
        location:    getText('.topcard__flavor--bullet'),
        description: getText('.description__text') || getText('.show-more-less-html__markup'),
      };
    });

    // Fall back to full page text if LinkedIn selectors returned nothing
    const pageText = await page.evaluate(() => document.body.innerText);

    if (pageText.length < 400 || /join now to see|sign in to see/i.test(pageText)) {
      throw new Error('LOGIN_WALL');
    }

    // If we got structured data from LinkedIn selectors, format it nicely
    if (linkedInData.title && linkedInData.description) {
      return [
        linkedInData.title,
        linkedInData.company,
        linkedInData.location,
        linkedInData.description,
      ].filter(Boolean).join('\n\n').slice(0, 8000);
    }

    return pageText.slice(0, 8000);
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeJobPage };
