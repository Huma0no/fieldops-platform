const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '../frontend/guided/data');
const readJson = file => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));

describe('Guided UT3000 communicating system', () => {
  let library, system;
  let buildModel, focusGroup, terminalConnections, isFieldMeasureSource, normalizeContext;
  let computeLayout, fitBox;

  const contexts = [];
  for (const zones of [1, 2, 3]) for (const dapc of [false, true]) contexts.push({ zones, dapc });

  beforeAll(async () => {
    library = readJson('guided-component-library.v0.1.json');
    system = readJson('ut3000-comm.system.json');
    ({ buildModel, focusGroup, terminalConnections, isFieldMeasureSource, normalizeContext } =
      await import('../frontend/guided/src/model.mjs'));
    ({ computeLayout } = await import('../frontend/guided/src/layout.mjs'));
    ({ fitBox } = await import('../frontend/guided/src/camera.mjs'));
  });

  it.each(contexts)('resolves every block, device and wire against the library for %o', ctx => {
    expect(() => buildModel(library, system, ctx)).not.toThrow();
  });

  it('normalizes context to 1–3 zones and a boolean DAPC flag', () => {
    expect(normalizeContext(system, { zones: 5, dapc: 'yes' })).toEqual({ zones: 3, dapc: false });
    expect(normalizeContext(system, { zones: 0 })).toEqual({ zones: 1, dapc: false });
    expect(normalizeContext(system, {})).toEqual({ zones: 3, dapc: false });
  });

  it('dims zone 3 blocks, devices and wires on a 2-zone call', () => {
    const model = buildModel(library, system, { zones: 2, dapc: true });
    for (const id of ['d3', 'z3c', 'z3v', 'tstat3', 'damper3', 'dapc3']) {
      expect(model.nodes.get(id).inactive).toBe(true);
    }
    for (const id of ['d2', 'z2c', 'tstat2', 'damper2', 'dapc2', 'd1', 'tstat1']) {
      expect(model.nodes.get(id).inactive).toBe(false);
    }
    const zone3Wires = model.wires.filter(w => [w.from.node, w.to.node].some(n => /3$/.test(n)));
    expect(zone3Wires.length).toBeGreaterThan(0);
    expect(zone3Wires.every(w => w.inactive)).toBe(true);
    expect(focusGroup(model, 'z3c')).toBeNull();
  });

  it('wires dampers directly without DAPC and through DAPC input/output with it', () => {
    const plain = buildModel(library, system, { zones: 3, dapc: false });
    expect([...plain.nodes.keys()].filter(id => /^dapc|^sbd2$|^taps$/.test(id))).toEqual([]);
    expect(terminalConnections(plain, 'd1', 'PO').map(c => `${c.other.node}.${c.other.terminal}`)).toEqual(['damper1.PO']);
    expect(plain.wires).toHaveLength(35);

    const withDapc = buildModel(library, system, { zones: 3, dapc: true });
    expect(terminalConnections(withDapc, 'd1', 'PO').map(c => `${c.other.node}.${c.other.terminal}`)).toEqual(['dapc1.iPO']);
    expect(terminalConnections(withDapc, 'damper1', 'PO').map(c => `${c.other.node}.${c.other.terminal}`)).toEqual(['dapc1.oPO']);
    expect(terminalConnections(withDapc, 'xf', 'R').map(c => c.other.node).sort()).toEqual(['dapcPwr', 'xfmr']);
    expect(withDapc.wires.filter(w => w.type === 'tube')).toHaveLength(4);
    expect(withDapc.wires).toHaveLength(52);
  });

  it('takes terminal draw order from the system file, not library key order', () => {
    const model = buildModel(library, system, { zones: 1 });
    expect(model.nodes.get('z1c').terminals.map(t => t.id)).toEqual(['C', '2', '1', 'R']);
    expect(model.nodes.get('damper1').terminals.map(t => t.label)).toEqual(['1 COM', '4 PO', '6 PC']);
  });

  it('shows library values by reference, so editing the JSON changes the UI data', () => {
    const edited = JSON.parse(JSON.stringify(library));
    edited.components.ut3000.blocks.out.terminals.G.exp = '9.9 VDC test value';
    edited.components.ut3000.blocks.out.terminals.G.src = 'Not in manual · measure in field';
    const model = buildModel(edited, system, { zones: 1 });
    const fact = model.nodes.get('out').terminals.find(t => t.id === 'G').fact;
    expect(fact.exp).toBe('9.9 VDC test value');
    expect(isFieldMeasureSource(fact.src)).toBe(true);
    expect(isFieldMeasureSource('UT3000 manual')).toBe(false);
  });

  it('marks blocks used only by non-communicating setups and unused device terminals', () => {
    const model = buildModel(library, system, { zones: 3, dapc: true });
    expect(['z1v', 'sys', 'oas'].every(id => model.nodes.get(id).unusedInSetup)).toBe(true);
    expect(['z1c', 'out', 'xf', 'iaq', 'sas'].some(id => model.nodes.get(id).unusedInSetup)).toBe(false);
    expect(model.nodes.get('dapcPwr').terminals.find(t => t.id === 'DATA').unused).toBe(true);
    expect(model.nodes.get('outdoor').terminals.filter(t => t.unused).map(t => t.id)).toEqual(['R', 'C']);
  });

  it('focuses the full transformer area and the full damper chain with DAPC', () => {
    const model = buildModel(library, system, { zones: 3, dapc: true });
    expect([...focusGroup(model, 'sbd2').nodes].sort()).toEqual(['dapcPwr', 'sbd2', 'taps', 'xf', 'xfmr']);
    expect([...focusGroup(model, 'damper2').nodes].sort()).toEqual(['d2', 'damper2', 'dapc2']);
    expect([...focusGroup(model, 'out').nodes].sort()).toEqual(['coil', 'furnace', 'out', 'outdoor']);
    expect(focusGroup(model, 'out').wires.size).toBe(10);
  });

  it.each(contexts)('lays out %o without overlapping boxes or wires through other boxes', ctx => {
    const model = buildModel(library, system, ctx);
    const layout = computeLayout(model);
    const rects = [...layout.rects.entries()];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [, a] = rects[i];
        const [, b] = rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    for (const wire of model.wires) {
      const points = layout.wirePaths.get(wire.id);
      for (let k = 0; k < points.length - 1; k++) {
        const [p, q] = [points[k], points[k + 1]];
        for (const [id, r] of rects) {
          if (id === wire.from.node || id === wire.to.node) continue;
          const crosses = Math.min(p.x, q.x) < r.x + r.w - 0.5 && Math.max(p.x, q.x) > r.x + 0.5 &&
            Math.min(p.y, q.y) < r.y + r.h - 0.5 && Math.max(p.y, q.y) > r.y + 0.5;
          expect(crosses).toBe(false);
        }
      }
    }
  });

  it('fits a box into the viewport aspect without cropping it', () => {
    const box = { x: 100, y: 200, w: 300, h: 120 };
    const vb = fitBox(box, 390, 600, { pad: 10, minW: 0 });
    expect(vb.w / vb.h).toBeCloseTo(390 / 600, 5);
    expect(vb.x).toBeLessThanOrEqual(box.x - 10);
    expect(vb.x + vb.w).toBeGreaterThanOrEqual(box.x + box.w + 10);
    expect(vb.y).toBeLessThanOrEqual(box.y);
    expect(vb.y + vb.h).toBeGreaterThanOrEqual(box.y + box.h);
  });
});
