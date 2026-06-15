const puppeteer = require('puppeteer');

async function scrapeJobPage(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // Mimic a real browser so LinkedIn doesn't immediately block
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Give JS-rendered content time to settle
    await new Promise(r => setTimeout(r, 2500));

    const text = await page.evaluate(() => document.body.innerText);

    if (
      text.length < 400 ||
      /join now to see|sign in to see|authwall/i.test(text)
    ) {
      throw new Error('LOGIN_WALL');
    }

    return text.slice(0, 8000);
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeJobPage };
