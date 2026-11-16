const fs = require('node:fs');
const path = require('node:path');

const PWA_ROOT = path.join(__dirname, '../frontend/pwa');
const swSource = () => fs.readFileSync(path.join(PWA_ROOT, 'sw.js'), 'utf8');

function filesUnder (dir, extensions) {
  return fs.readdirSync(path.join(PWA_ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(rel, extensions);
    return extensions.some(ext => entry.name.endsWith(ext)) ? [`/${rel}`] : [];
  });
}

describe('PWA shell versioning', () => {
  let shellAssets, stampedSource;

  beforeAll(async () => {
    ({ shellAssets, stampedSource } = await import('../scripts/pwa-version.mjs'));
  });

  it('has a shell cache stamp that matches the current shell files (run npm run pwa:version)', () => {
    expect(stampedSource(swSource())).toBe(swSource());
  });

  it('precaches every PWA and Guided module so they work offline', () => {
    const listed = new Set(shellAssets(swSource()));
    const shipped = [
      ...filesUnder('src', ['.js', '.mjs']),
      '/guided/guided.js',
      ...filesUnder('guided/src', ['.mjs']),
      ...filesUnder('guided/data', ['.json']),
    ];
    expect(shipped.filter(file => !listed.has(file))).toEqual([]);
  });
});
