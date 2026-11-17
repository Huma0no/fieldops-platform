const fs = require('fs/promises');
const path = require('path');

let starts;

function asModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

beforeAll(async () => {
  const source = (await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/pending-starts.mjs'), 'utf8'))
    .replace("'../../../shared/api.js'", `'${asModule('export const api = {};')}'`)
    .replace("'./db.js'", `'${asModule('export const getActiveTechnicianId = () => null; export const getLocalVisitDraft = async () => null; export const saveLocalVisitDraft = async () => {};')}'`);
  starts = await import(asModule(source));
});

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));
const answered = status => () => Promise.reject(Object.assign(new Error('answered'), { status }));

describe('Start without a connection', () => {
  it('marks the downloaded draft started and records the Start for later', async () => {
    const storage = memoryStorage();
    const draft = { id: 'visit-1', status: 'assigned' };
    const saved = [];
    await starts.startVisitLocalFirst('visit-1', {
      storage, technicianId: 'tech-1', startVisit: offline,
      getDraft: async () => draft, saveDraft: async d => saved.push({ ...d }),
    });
    expect(saved).toEqual([{ id: 'visit-1', status: 'in_progress' }]);
    expect(starts.readPendingStarts(storage, 'tech-1')).toEqual(['visit-1']);
  });

  it('fails like before when there is no downloaded draft to work on', async () => {
    await expect(starts.startVisitLocalFirst('visit-2', {
      storage: memoryStorage(), technicianId: 'tech-1', startVisit: offline,
      getDraft: async () => null, saveDraft: async () => {},
    })).rejects.toThrow('Failed to fetch');
  });

  it('does not hide a server answer behind a pending Start', async () => {
    const storage = memoryStorage();
    await expect(starts.startVisitLocalFirst('visit-3', {
      storage, technicianId: 'tech-1', startVisit: answered(403),
      getDraft: async () => ({ id: 'visit-3' }), saveDraft: async () => {},
    })).rejects.toThrow('answered');
    expect(starts.readPendingStarts(storage, 'tech-1')).toEqual([]);
  });
});

describe('pending Start delivery', () => {
  it('sends each pending Start once the server answers, keeping them while offline', async () => {
    const storage = memoryStorage();
    starts.recordPendingStart(storage, 'tech-1', 'visit-1');
    starts.recordPendingStart(storage, 'tech-1', 'visit-2');

    await starts.flushPendingStarts({ storage, technicianId: 'tech-1', startVisit: offline });
    expect(starts.readPendingStarts(storage, 'tech-1')).toEqual(['visit-1', 'visit-2']);

    const sent = [];
    await starts.flushPendingStarts({
      storage, technicianId: 'tech-1',
      startVisit: id => (id === 'visit-2' ? answered(400)() : Promise.resolve(sent.push(id))),
    });
    expect(sent).toEqual(['visit-1']);
    expect(starts.readPendingStarts(storage, 'tech-1')).toEqual([]);
  });

  it('keeps pending Starts per technician', () => {
    const storage = memoryStorage();
    starts.recordPendingStart(storage, 'tech-1', 'visit-1');
    expect(starts.readPendingStarts(storage, 'tech-2')).toEqual([]);
  });
});
