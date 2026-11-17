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
      { id: 'p-1', slug: '7746_TRIBUTE_CIR_SCALE_SYS2' },
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

it('offline: zips the photos still on the phone, sent or not, and lists the rest as needing a connection', async () => {
  const result = await download.buildReportDownload(visit, 'all', {
    online: false,
    loadLocal: onPhone,
    loadReport: async () => { throw new TypeError('Failed to fetch'); },
  });
  expect(result.fileName).toBe('report-visit-1.zip');
  expect(await unzip(result.blob)).toEqual({
    '7746_TRIBUTE_CIR_SCALE_SYS2.jpg': 'scale',
    '5523_SILK_PETAL_ELECTRIC_METER.jpg': 'meter',
  });
  expect(result.missing).toEqual([
    { name: 'report-visit-1.json', needsConnection: true },
    { name: '5523_SILK_PETAL_ELECTRIC_METER_2.jpg', needsConnection: true },
  ]);
});

it('online: fetches older photos from the server and adds the Report JSON', async () => {
  const result = await download.buildReportDownload(visit, 'all', {
    online: true,
    loadLocal: onPhone,
    loadServerList: async () => [{ id: 'p-4', slug: '5523_SILK_PETAL_FAN_SYS1' }],
    fetchPhoto: async (_visitId, id) => (id === 'p-4' ? new Blob(['fan']) : id === 'p-3' ? new Blob(['meter2']) : null),
    loadReport: async () => ({ reportText: 'AC started $30' }),
  });
  const files = await unzip(result.blob);
  expect(Object.keys(files)).toEqual([
    'report-visit-1.json', '7746_TRIBUTE_CIR_SCALE_SYS2.jpg', '5523_SILK_PETAL_ELECTRIC_METER.jpg',
    '5523_SILK_PETAL_ELECTRIC_METER_2.jpg', '5523_SILK_PETAL_FAN_SYS1.jpg',
  ]);
  expect(JSON.parse(files['report-visit-1.json'])).toEqual({ reportText: 'AC started $30' });
  expect(result.missing).toEqual([]);

  const photosOnly = await download.buildReportDownload(visit, 'zip', { online: false, loadLocal: onPhone });
  expect(photosOnly.fileName).toBe('report-visit-1-photos.zip');
  expect(Object.keys(await unzip(photosOnly.blob))).toHaveLength(2);
});
