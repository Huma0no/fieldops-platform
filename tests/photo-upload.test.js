const fs = require('fs/promises');
const path = require('path');

let photos;

function asModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

beforeAll(async () => {
  const source = (await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/photo-upload.mjs'), 'utf8'))
    .replace("'../../../shared/api.js'", `'${asModule('export const api = {};')}'`)
    .replace("'./db.js'", `'${asModule('export const getActiveTechnicianId = () => null; export const getPendingPhotos = async () => []; export const deletePendingPhoto = async () => {}; export const savePendingPhoto = async () => {};')}'`);
  photos = await import(asModule(source));
});

const record = (id, photoId) => ({
  id, photoId, visitId: 'visit-1', blob: new Blob(['jpeg']), tag: 'FAN', category: 'fan_speed',
  systemNumber: 2, slug: '1 MAIN_FAN_SYS2', lat: '29.7', lon: '-95.3',
});

it('keeps the photo on the phone and returns its evidence reference', async () => {
  const saved = [];
  const ref = await photos.keepPhoto({
    visitId: 'visit-1', technicianId: 'tech-1', blob: new Blob(['jpeg']), tag: 'FAN', category: 'fan_speed',
    systemNumber: 2, street: '1 Main St', save: async (r, tech) => saved.push([r, tech]),
  });
  expect(ref).toEqual({ id: expect.any(String), slug: '1_MAIN_ST_FAN_SYS2', tag: 'FAN', label: null, category: 'fan_speed', systemNumber: 2, storedAt: null });
  expect(saved[0][0]).toMatchObject({ photoId: ref.id, visitId: 'visit-1', slug: ref.slug });
  expect(saved[0][1]).toBe('tech-1');
});

it('deletes a photo from the phone only after the server stored it', async () => {
  const removed = [];
  const sent = [];
  await photos.uploadPendingPhotos({
    technicianId: 'tech-1',
    load: async () => [record(1, 'p-1'), record(2, 'p-2')],
    remove: async id => removed.push(id),
    send: async (visitId, form) => sent.push([visitId, form.get('photoId'), form.get('systemNumber'), form.get('lat')]),
  });
  expect(sent).toEqual([['visit-1', 'p-1', '2', '29.7'], ['visit-1', 'p-2', '2', '29.7']]);
  expect(removed).toEqual([1, 2]);
});

it('stops while offline and keeps a rejected photo for the next attempt', async () => {
  const removed = [];
  await photos.uploadPendingPhotos({
    technicianId: 'tech-1',
    load: async () => [record(1, 'p-1'), record(2, 'p-2')],
    remove: async id => removed.push(id),
    send: async () => { throw new TypeError('Failed to fetch') },
  });
  expect(removed).toEqual([]);

  await photos.uploadPendingPhotos({
    technicianId: 'tech-1',
    load: async () => [record(1, 'p-1'), record(2, 'p-2')],
    remove: async id => removed.push(id),
    send: async (_visit, form) => {
      if (form.get('photoId') === 'p-1') throw Object.assign(new Error('rejected'), { status: 409 });
    },
  });
  expect(removed).toEqual([2]);
});
