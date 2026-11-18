// Synthetic CP3000-style route PDF for tests: every text line is a raster
// image strip at 600 ppi (no fonts, no text layer), like the real route
// sheets printed through "Microsoft Print to PDF". Fake data only.
const { createCanvas } = require('@napi-rs/canvas');

const PPI = 600;
const PAGE_W = 612; // points (8.5 in)
const PAGE_H = 792; // points (11 in)
const MARGIN = 36;
const LINE_PT = 13;
const STRIP_W_IN = (PAGE_W - 2 * MARGIN) / 72;

// A line is a string or an array of [text, xInches] segments.
function stripJpeg(line, { bold = false } = {}) {
  const w = Math.round(STRIP_W_IN * PPI);
  const h = Math.round((LINE_PT / 72) * PPI);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  ctx.font = `${bold ? 'bold ' : ''}${Math.round((9 / 72) * PPI)}px Arial`;
  ctx.textBaseline = 'middle';
  const segments = typeof line === 'string' ? [[line, 0]] : line;
  for (const [text, xIn] of segments) ctx.fillText(text, Math.round(xIn * PPI), h / 2);
  return { jpeg: canvas.toBuffer('image/jpeg', 92), w, h };
}

// pages: [{ lines: [line | { line, bold }] }]
function makeRoutePdf(pages) {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const catalogId = add(null);
  const pagesId = add(null);
  const pageIds = [];
  for (const page of pages) {
    const images = [];
    let y = PAGE_H - MARGIN - LINE_PT;
    const ops = [];
    for (const entry of page.lines) {
      const { line, bold } = typeof entry === 'object' && !Array.isArray(entry) ? entry : { line: entry, bold: false };
      if (line !== '') {
        const { jpeg, w, h } = stripJpeg(line, { bold });
        const id = add({ stream: jpeg, dict: `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>` });
        const name = `Im${images.length}`;
        images.push([name, id]);
        ops.push(`q ${PAGE_W - 2 * MARGIN} 0 0 ${LINE_PT} ${MARGIN} ${y} cm /${name} Do Q`);
      }
      y -= LINE_PT;
    }
    const content = Buffer.from(ops.join('\n'));
    const contentId = add({ stream: content, dict: `<< /Length ${content.length} >>` });
    const xobjects = images.map(([n, id]) => `/${n} ${id} 0 R`).join(' ');
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << ${xobjects} >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const parts = typeof obj === 'string'
      ? [Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`)]
      : [Buffer.from(`${i + 1} 0 obj\n${obj.dict}\nstream\n`), obj.stream, Buffer.from('\nendstream\nendobj\n')];
    for (const part of parts) { chunks.push(part); length += part.length; }
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

module.exports = { makeRoutePdf };
