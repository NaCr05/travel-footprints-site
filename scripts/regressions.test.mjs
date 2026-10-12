import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validatePlaces } from './data.mjs';
import { publicPlaces, publicWishlist, copyPublicFiles } from './public-site.mjs';
import { createPreviewServer } from './serve.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const city = (id = 'springfield-il', dated = true) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [-89.64, 39.8] }, properties: {
  name: 'Springfield', nameEn: 'Springfield', displayName: 'Springfield', country: 'United States', countryCode: 'US', region: 'Illinois', category: dated ? 'visited' : 'residence',
  visits: dated ? [{ when: '2025-12', precision: 'month', photos: [], link: null }] : [], photos: [], link: null, note: ''
} });
const places = features => ({ type: 'FeatureCollection', schemaVersion: 1, features });
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'travel-regression-'));
  t.after(async () => {
    const target = path.resolve(root), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(target), parent);
    assert(path.basename(target).startsWith('travel-regression-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  return root;
}
async function write(root, name, content) {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), typeof content === 'string' ? content : JSON.stringify(content));
}
test('same-country names may repeat but stable city IDs must be unique', () => {
  const other = city('springfield-ma'); other.geometry.coordinates = [-72.59, 42.1]; other.properties.region = 'Massachusetts';
  assert.equal(validatePlaces(places([city(), other])).places, 2);
  assert.throws(() => validatePlaces(places([city(), city()])), /Duplicate id/);
});
test('empty, undated and single dated maps build and validate albums', async t => {
  const root = await temporary(t);
  for (const name of ['scripts', 'site', 'data/basemaps']) await fs.cp(path.join(repository, name), path.join(root, name), { recursive: true });
  for (const name of ['package.json', 'vendor/d3.min.js', 'vendor/package.json']) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.copyFile(path.join(repository, name), path.join(root, name));
  }
  await fs.mkdir(path.join(root, 'docs'));
  await write(root, 'data/photo-albums.json', { schemaVersion: 1, albums: [] });
  for (const features of [[], [city('home', false)], [city()]]) {
    await write(root, 'data/places.geojson', places(features));
    for (const script of ['build.mjs', 'check.mjs', 'check-albums.mjs']) execFileSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'pipe', timeout: 30_000, windowsHide: true });
    const svg = await fs.readFile(path.join(root, 'assets/travel-map.svg'), 'utf8');
    assert(!/null|undefined|NaN/.test(svg));
    if (!features[0]?.properties.visits.length) assert(svg.includes('尚未记录到访月份'));
    const details = await fs.readFile(path.join(root, 'assets/travel-map-details.svg'), 'utf8');
    assert(details.includes('东亚0个地点与欧洲0个地点'));
  }
});

async function website(root) {
  const record = city();
  record.properties.photos = [{ src: 'photos/public.jpg', caption: 'Visible', privateNotes: 'hidden-photo' }];
  record.properties.visits[0].internalNote = 'hidden-visit';
  record.properties.link = './stories/public.html';
  const data = places([record]); data.privateNotes = 'hidden-root';
  const wish = { schemaVersion: 1, privateNotes: 'hidden-wishes', cities: [{ id: '1', nameEn: 'Example', nameZh: '', countryCode: 'US', region: '', coordinates: [0, 0], reason: 'Visible reason', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', privateNotes: 'hidden-city' }] };
  for (const [name, content] of Object.entries({
    'index.html': '<!doctype html><title>Synthetic map</title>', '.nojekyll': '', 'THIRD_PARTY.md': 'Attributions',
    'site/app.js': '// public script', 'site/mark.svg': '<svg/>', 'site/app.test.js': '// test only', 'vendor/library.js': '// bundled', 'assets/map.svg': '<svg/>',
    'data/places.geojson': data, 'data/photo-albums.json': { schemaVersion: 1, albums: [] }, 'data/wishlist.json': wish,
    'photos/public.jpg': 'synthetic public image', 'photos/unreferenced.jpg': 'unreferenced image', 'stories/public.html': '<p>Visible story</p>', 'stories/private.txt': 'private story',
    'private/canary.txt': 'private canary', '.env': 'synthetic secret'
  })) await write(root, name, content);
  return { data, wish };
}
test('export includes referenced media and only explicit public fields', async t => {
  const root = await temporary(t), destination = path.join(root, 'export');
  const { data, wish } = await website(root);
  const projected = publicPlaces(data), projectedWish = publicWishlist(wish);
  assert(!JSON.stringify(projected).includes('hidden-'));
  assert(!JSON.stringify(projectedWish).includes('hidden-'));
  assert.equal(projectedWish.cities[0].reason, 'Visible reason');
  await copyPublicFiles(root, destination, projected);
  for (const name of ['index.html', 'site/app.js', 'site/mark.svg', 'photos/public.jpg', 'stories/public.html']) assert((await fs.stat(path.join(destination, name))).isFile());
  for (const name of ['photos/unreferenced.jpg', 'stories/private.txt', 'private/canary.txt', '.env', 'data/photo-albums.json', 'site/app.test.js']) await assert.rejects(fs.stat(path.join(destination, name)), { code: 'ENOENT' });
  assert.equal(data.features[0].properties.visits[0].internalNote, 'hidden-visit');
  await assert.rejects(copyPublicFiles(root, path.join(root, 'site/export'), projected), /outside the input directories/);
});
test('local preview rejects private files, foreign origins/hosts and linked directories', async t => {
  const root = await temporary(t); await website(root);
  const outside = await temporary(t); await write(outside, 'canary.js', '// outside canary');
  await fs.symlink(outside, path.join(root, 'site/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = createPreviewServer({ root, base: '/map' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const port = server.address().port;
  const request = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
    }); req.on('error', reject); req.end();
  });
  for (const url of ['/map/', '/map/site/app.js', '/map/site/mark.svg', '/map/photos/public.jpg', '/map/stories/public.html']) assert.equal((await request(url)).status, 200, url);
  for (const url of ['/map/private/canary.txt', '/map/.env', '/map/photos/unreferenced.jpg', '/map/stories/private.txt', '/map/data/photo-albums.json', '/map/site/app.test.js', '/map/site/linked/canary.js']) assert.notEqual((await request(url)).status, 200, url);
  assert.equal((await request('/map/', { Host: 'foreign.invalid' })).status, 403);
  assert.equal((await request('/map/', { Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await request('/map/', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/map/', { Origin: `http://127.0.0.1:${port}` })).status, 200);
  assert.equal((await request('/map/', {}, 'POST')).status, 405);
  assert.equal((await request('/')).status, 404);
  assert.equal((await request('/map/', {}, 'HEAD')).body, '');
  for (const name of ['places.geojson', 'wishlist.json']) assert(!(await request(`/map/data/${name}`)).body.includes('hidden-'));
  await assert.rejects(copyPublicFiles(root, path.join(root, 'export'), publicPlaces(places([]))), /Linked public asset/);
});
