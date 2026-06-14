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
      const text = pdfData.Pages.map(page =>
        page.Texts.map(t => decodeURIComponent(t.R[0].T)).join(' ')
      ).join('\n');
      resolve(text);
    });
    pdfParser.on('pdfParser_dataError', (error) => reject(error));
    pdfParser.loadPDF(filePath);
  });
}

module.exports = { readCV };
