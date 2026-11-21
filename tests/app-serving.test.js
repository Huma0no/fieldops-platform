// Pilot hosting (PP-02): the server serves FieldOps at / and Dispatch's build
// at /dispatch/, alongside /api, from one origin.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/index');
const { pool } = require('./helpers/db');

afterAll(() => pool.end());

const shellAssets = () => {
  const sw = fs.readFileSync(path.join(__dirname, '../frontend/pwa/sw.js'), 'utf8');
  return sw.match(/SHELL_ASSETS = \[([\s\S]*?)\]/)[1].match(/'[^']+'/g).map(entry => entry.slice(1, -1));
};

it('serves every FieldOps file its service worker precaches, without a session', async () => {
  const assets = shellAssets();
  expect(assets.length).toBeGreaterThan(20);
  for (const asset of assets) {
    const res = await request(app).get(asset);
    expect({ asset, status: res.status }).toEqual({ asset, status: 200 });
  }
  const module = await request(app).get('/src/lib/lineset.mjs');
  expect(module.headers['content-type']).toMatch(/javascript/);
});

it('serves every icon the FieldOps manifest lists, so the home-screen install has one', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/pwa/manifest.json'), 'utf8'));
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const res = await request(app).get(icon.src);
    expect({ src: icon.src, status: res.status, type: res.headers['content-type'] }).toEqual({ src: icon.src, status: 200, type: 'image/png' });
  }
});

it('keeps the API behind the session check and ignores dotfiles', async () => {
  expect((await request(app).get('/api/visits/mine')).status).toBe(401);
  expect((await request(app).get('/.DS_Store')).status).toBe(401);
});

it('the FieldOps service worker never serves Dispatch paths', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../frontend/pwa/sw.js'), 'utf8');
  expect(sw).toContain("url.pathname.startsWith('/dispatch/')");
});
