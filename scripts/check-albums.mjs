import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlacesWithAlbums, mergePhotoAlbums, photoPath } from './albums.mjs';
import { validatePlaces } from './data.mjs';
import { photoEntries } from '../site/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = JSON.parse(await fs.readFile(path.join(root, 'data/places.geojson'), 'utf8'));
const before = JSON.stringify(original);
assert.deepEqual(mergePhotoAlbums(original, { schemaVersion: 1, albums: [] }), original);
assert.deepEqual(mergePhotoAlbums(original, { schemaVersion: 1 }), original);

// Synthetic paths test the integration without adding pretend travel photos.
const city = original.features.find(feature => feature.properties.visits.length);
const month = city.properties.visits[0].when;
assert.deepEqual(mergePhotoAlbums(original, { schemaVersion: 1, albums: [{ cityId: city.id }] }), original);
const photos = [
  { src: './photos/test-one.jpg', caption: 'First photo' },
  { src: './photos/test-two.webp', caption: 'Second photo' }
];
const document = { schemaVersion: 1, albums: [{ cityId: city.id, when: month, photos }] };
const merged = mergePhotoAlbums(original, document);
const target = merged.features.find(feature => feature.id === city.id);
assert.deepEqual(photoEntries(target.properties).slice(-2), photos.map(photo => ({ ...photo, when: month })));
assert.deepEqual(validatePlaces(merged), validatePlaces(original));
assert.deepEqual(merged.features.filter(feature => feature.id !== city.id), original.features.filter(feature => feature.id !== city.id));
assert.equal(JSON.stringify(original), before, 'CMS merge mutated the canonical city data.');

const cityAlbum = structuredClone(document);
cityAlbum.albums[0].when = '';
assert.deepEqual(mergePhotoAlbums(original, cityAlbum).features.find(feature => feature.id === city.id).properties.photos.slice(-2), photos);

for (const [change, message] of [
  [album => { album.cityId = 'unknown-city'; }, /Unknown album city/],
  [album => { album.when = '1900-01'; }, /not an existing visit/],
  [album => { album.when = '2025-13'; }, /YYYY-MM/],
  [album => { album.photos.push(photos[0]); }, /up to two photos/],
  [album => { album.photos[1] = album.photos[0]; }, /Duplicate photo/]
]) {
  const invalid = structuredClone(document);
  change(invalid.albums[0]);
  assert.throws(() => mergePhotoAlbums(original, invalid), message);
}
assert.throws(() => mergePhotoAlbums(original, { ...document, albums: [...document.albums, ...document.albums] }), /one city album/);
for (const src of ['./photos/../private.jpg', './photos//x.jpg', './photos/.hidden.jpg', '/photos/x.jpg', 'https://example.com/x.jpg', './photos/x.svg', './photos/%2e%2e/x.jpg', './photos/x.jpg?secret=1', './photos/x\\y.jpg']) {
  assert.throws(() => photoPath(src), undefined, `Unsafe photo path accepted: ${src}`);
}

const current = await loadPlacesWithAlbums(root);
assert.deepEqual(validatePlaces(current), validatePlaces(original));
console.log(JSON.stringify({ result: 'PASS', checks: ['CMS album isolation', 'two photos retain visit month', 'other cities unchanged', 'CMS empty-field serialization', 'unknown city/month rejected', 'safe project-relative photo paths', 'current album file validation'], places: current.features.length }));
