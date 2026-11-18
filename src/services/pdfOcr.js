// Route sheet OCR, fully offline: the CP3000 route PDFs have no text layer
// (every line is a raster strip), so each page is rendered at 300 dpi with
// pdf.js and read with tesseract.js using the English model bundled from npm
// (@tesseract.js-data/eng). No external API and no runtime download.
const os = require('os');
const path = require('path');

const RENDER_DPI = 300;
const LANG_PATH = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0');

async function renderPages(pdfBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_DPI / 72 });
      const { canvas, context } = doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      pages.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

// Returns one entry per page: { text, lines: [{ text, confidence }] }.
async function ocrPdf(pdfBuffer) {
  const images = await renderPages(pdfBuffer);
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng', 1, {
    langPath: LANG_PATH,
    gzip: true,
    cacheMethod: 'none',
    cachePath: os.tmpdir(),
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
    const pages = [];
    for (const image of images) {
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(p => p.lines))
        .map(line => ({ text: line.text.replace(/\n$/, ''), confidence: line.confidence }));
      pages.push({ text: data.text, lines });
    }
    return pages;
  } finally {
    await worker.terminate();
  }
}

module.exports = { ocrPdf, renderPages, RENDER_DPI };
