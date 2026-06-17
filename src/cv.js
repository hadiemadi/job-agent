const originalLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Warning:')) return;
  originalLog(...args);
};

const PDFParser = require('pdf2json');

async function readCV(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      const text = pdfData.Pages.map(page => {
        const items = page.Texts;
        if (!items || items.length === 0) return '';
        let result = '';
        for (let i = 0; i < items.length; i++) {
          const curr = items[i];
          const content = decodeURIComponent(curr.R[0].T);
          if (i === 0) { result += content; continue; }
          const prev = items[i - 1];
          const sameLine = Math.abs(curr.y - prev.y) < 0.05;
          // gap between right edge of previous token and left edge of current token.
          // A negative or near-zero gap means the tokens are adjacent (split within a word).
          // A gap >= 0.5 indicates a real word space.
          const gap = curr.x - (prev.x + prev.w);
          result += (sameLine && gap < 0.5) ? content : ' ' + content;
        }
        return result;
      }).join('\n');
      resolve(text);
    });
    pdfParser.on('pdfParser_dataError', (error) => reject(error));
    pdfParser.loadPDF(filePath);
  });
}

module.exports = { readCV };
