const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

let download;

function asModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

beforeAll(async () => {
  const read = file => fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib', file), 'utf8');
  const source = (await read('report-download.mjs'))
    .replace("'../../../shared/api.js'", `'${asModule('export const api = {};')}'`)
    .replace("'./db.js'", `'${asModule('export const getPhotosForVisit = async () => [];')}'`)
    .replace("'./zip.mjs'", `'${asModule(await read('zip.mjs'))}'`);
  download = await import(asModule(source));
});

// Reads a stored ZIP through its central directory and checks each CRC.
async function unzip(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  let at = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString();
    const local = buf.readUInt32LE(at + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const data = buf.subarray(start, start + size);
    expect(zlib.crc32(data)).toBe(buf.readUInt32LE(at + 16));
    files[name] = data.toString();
    at += 46 + nameLength;
  }
  return files;
}

const visit = {
  id: 'visit-1',
  snapshot: {
    evidenceRefs: [
      { id: 'p-1', slug: '7746_TRIBUTE_CIR_SCALE_SYS2', tag: 'SCALE' },
      { id: 'p-2', slug: '5523_SILK_PETAL_ELECTRIC_METER' },
      { id: 'p-3', slug: '5523_SILK_PETAL_ELECTRIC_METER' },
    ],
  },
};
const onPhone = async () => [
  { photoId: 'p-1', blob: new Blob(['scale']), pendingUpload: false },
  { photoId: 'p-2', blob: new Blob(['meter']), pendingUpload: true },
];

it('names photos with the address_tag[_SYSn] convention', () => {
  expect(download.photoFileNames(visit.snapshot.evidenceRefs)).toEqual([
    '7746_TRIBUTE_CIR_SCALE_SYS2.jpg', '5523_SILK_PETAL_ELECTRIC_METER.jpg', '5523_SILK_PETAL_ELECTRIC_METER_2.jpg',
  ]);
});

it('offline: exports the phone snapshot, marked unconfirmed, with the photos still on the phone', async () => {
  const offline = { online: false, loadLocal: onPhone, loadServerReport: async () => { throw new TypeError('Failed to fetch'); } };
  const result = await download.buildReportDownload(visit, 'all', offline);
  expect(result.fileName).toBe('report-visit-1.zip');
  const files = await unzip(result.blob);
  // SCALE/FAN never come from the phone copy (no GPS in it; CC-17).
  expect(Object.keys(files)).toEqual(['report-visit-1.json', '5523_SILK_PETAL_ELECTRIC_METER.jpg']);
  expect(JSON.parse(files['report-visit-1.json'])).toEqual({ source: 'local, unconfirmed by server', report: visit.snapshot });
  expect(result.missing).toEqual([
    { name: '7746_TRIBUTE_CIR_SCALE_SYS2.jpg', needsConnection: true },
    { name: '5523_SILK_PETAL_ELECTRIC_METER_2.jpg', needsConnection: true },
  ]);

  const json = await download.buildReportDownload(visit, 'json', offline);
  expect(json.fileName).toBe('report-visit-1.json');
  expect(JSON.parse(await json.blob.text()).source).toBe('local, unconfirmed by server');

  // Not delivered yet: the phone snapshot even when the server is reachable.
  const pending = await download.buildReportDownload(visit, 'json', { delivered: false, loadServerReport: async () => { throw new Error('not called'); } });
  expect(JSON.parse(await pending.blob.text()).source).toBe('local, unconfirmed by server');
});

it('online: fetches older photos from the server and adds the Report JSON', async () => {
  const result = await download.buildReportDownload(visit, 'all', {
    online: true,
    loadLocal: onPhone,
    loadServerList: async () => [{ id: 'p-4', slug: '5523_SILK_PETAL_FAN_SYS1', tag: 'FAN' }],
    fetchPhoto: async (_visitId, id) => ({ 'p-1': new Blob(['scale-with-gps']), 'p-4': new Blob(['fan']), 'p-3': new Blob(['meter2']) })[id] ?? null,
    loadServerReport: async () => ({ reportText: 'AC started $30', report: { totalPrice: 30, priceDiscrepancies: [] } }),
  });
  const files = await unzip(result.blob);
  expect(Object.keys(files)).toEqual([
    'report-visit-1.json', '7746_TRIBUTE_CIR_SCALE_SYS2.jpg', '5523_SILK_PETAL_ELECTRIC_METER.jpg',
    '5523_SILK_PETAL_ELECTRIC_METER_2.jpg', '5523_SILK_PETAL_FAN_SYS1.jpg',
  ]);
  expect(JSON.parse(files['report-visit-1.json'])).toEqual({
    source: 'server', reportText: 'AC started $30', report: { totalPrice: 30, priceDiscrepancies: [] },
  });
  // The SCALE photo is the server copy even though the phone still has one.
  expect(files['7746_TRIBUTE_CIR_SCALE_SYS2.jpg']).toBe('scale-with-gps');
  expect(files['5523_SILK_PETAL_ELECTRIC_METER.jpg']).toBe('meter');
  expect(result.missing).toEqual([]);

  const photosOnly = await download.buildReportDownload(visit, 'zip', { online: false, loadLocal: onPhone });
  expect(photosOnly.fileName).toBe('report-visit-1-photos.zip');
  expect(Object.keys(await unzip(photosOnly.blob))).toHaveLength(1);
});

it('online: a SCALE/FAN photo not uploaded yet is listed as still uploading, not taken from the phone', async () => {
  const result = await download.buildReportDownload(visit, 'zip', {
    online: true,
    loadLocal: onPhone,
    loadServerList: async () => [],
    fetchPhoto: async (_visitId, id) => (id === 'p-3' ? new Blob(['meter2']) : null),
  });
  expect(Object.keys(await unzip(result.blob))).toEqual(['5523_SILK_PETAL_ELECTRIC_METER.jpg', '5523_SILK_PETAL_ELECTRIC_METER_2.jpg']);
  expect(result.missing).toEqual([{ name: '7746_TRIBUTE_CIR_SCALE_SYS2.jpg', needsConnection: false, waitingUpload: true }]);
});
