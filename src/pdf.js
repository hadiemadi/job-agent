const puppeteer = require('puppeteer');
const path = require('path');

async function generatePDF(htmlFilePath) {
  const absolutePath = path.resolve(htmlFilePath);
  const pdfPath = htmlFilePath.replace('.html', '.pdf');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${absolutePath}`, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}

module.exports = { generatePDF };
