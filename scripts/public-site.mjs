import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateWishlist } from '../site/wishlist-model.js';

const photos = entries => (entries || []).map(photo => typeof photo === 'string' ? photo : { src: photo.src, caption: photo.caption || '' });
export function publicPlaces(original) {
  return {
    type: original.type, schemaVersion: original.schemaVersion, updatedOn: original.updatedOn, attribution: original.attribution,
    features: original.features.map(({ type, id, geometry, properties: p }) => ({
      type, id, geometry: { type: geometry.type, coordinates: [...geometry.coordinates] },
      properties: {
        name: p.name, nameEn: p.nameEn, displayName: p.displayName,
        country: p.country, countryCode: p.countryCode, region: p.region, category: p.category,
        visits: p.visits.map(v => ({ when: v.when, precision: v.precision, photos: photos(v.photos), link: v.link ?? null })),
        photos: photos(p.photos), link: p.link, note: p.note,
        sourceInput: { city: p.sourceInput?.city || p.name }
      }
    }))
  };
}
export function publicWishlist(original) {
  const doc = validateWishlist(original);
  return { schemaVersion: doc.schemaVersion, cities: doc.cities.map(c => ({
    id: c.id, nameEn: c.nameEn, nameZh: c.nameZh, countryCode: c.countryCode, region: c.region,
    coordinates: [...c.coordinates], ...(c.visitedId ? { visitedId: c.visitedId } : {}),
    reason: c.reason, createdAt: c.createdAt, updatedAt: c.updatedAt
  })) };
}
export function referencedFiles(places) {
  const files = new Set();
  const add = (value, folder) => {
    if (typeof value !== 'string') return;
    const normalized = value.startsWith('./') ? value.slice(2) : value;
    if (!normalized.startsWith(`${folder}/`)) return;
    const relative = normalized.split(/[?#]/, 1)[0];
    assert(!relative.includes('\\') && !relative.includes('%') && relative.split('/').every(p => p && !p.startsWith('.')), 'Unsafe public asset path.');
    assert(folder !== 'photos' || /\.(?:jpe?g|png|webp)$/i.test(relative), 'Unsupported public photo type.');
    files.add(relative);
  };
  for (const { properties: p } of places.features) for (const entry of [p, ...p.visits]) {
    for (const photo of entry.photos || []) add(typeof photo === 'string' ? photo : photo.src, 'photos');
    add(entry.link, 'stories');
  }
  return files;
}
export function isPublicStatic(relative) {
  if (relative.includes('\\') || relative.split('/').some(p => !p || p.startsWith('.')) || /\.test\.[cm]?js$/.test(relative)) return relative === '.nojekyll';
  if (['index.html', 'THIRD_PARTY.md', 'data/sources.json', 'vendor/d3-LICENSE', 'vendor/maplibre/LICENSE.txt'].includes(relative)) return true;
  return /^(?:site|vendor)\/.*\.(?:js|mjs|css|svg)$/.test(relative)
    || /^assets\/.*\.(?:svg|png|jpe?g|webp|ico)$/.test(relative)
    || /^data\/basemaps\/world-(?:50m|110m)\.geojson$/.test(relative)
    || /^data\/cities\/(?:index|locales|[0-9]|1[0-5])\.json$/.test(relative);
}
export async function publicFile(root, relative) {
  const realRoot = await fs.realpath(root);
  const expected = path.resolve(realRoot, relative);
  assert(expected.startsWith(realRoot + path.sep), 'Asset escaped the website root.');
  const resolved = await fs.realpath(expected);
  const normalize = p => process.platform === 'win32' ? p.toLowerCase() : p;
  assert.equal(normalize(resolved), normalize(expected), 'Linked public assets are not supported.');
  assert((await fs.stat(resolved)).isFile(), 'Expected a regular public file.');
  return resolved;
}
export async function copyPublicFiles(root, destination, places) {
  const inside = path.relative(path.resolve(root), path.resolve(destination));
  assert(inside && !['site', 'vendor', 'assets', 'data', 'photos', 'stories'].includes(inside.split(path.sep)[0]), 'Export outside the input directories.');
  const files = new Set(['index.html', '.nojekyll', 'THIRD_PARTY.md', ...referencedFiles(places)]);
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.name.startsWith('.')) continue;
      assert(!entry.isSymbolicLink(), `Linked public asset: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (isPublicStatic(name)) files.add(name);
    }
  }
  for (const directory of ['site', 'vendor', 'assets', 'data']) {
    assert(!(await fs.lstat(path.join(root, directory))).isSymbolicLink(), 'Linked public directory.');
    await walk(directory);
  }
  for (const relative of files) {
    const source = await publicFile(root, relative);
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}
