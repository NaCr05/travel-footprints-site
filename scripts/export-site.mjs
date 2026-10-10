import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlaces } from './data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] || path.join(root, 'dist'));
assert(destination !== root, 'Export into a separate empty directory.');
await fs.mkdir(destination, { recursive: true });
assert.equal((await fs.readdir(destination)).length, 0, 'Use an empty export directory to avoid retaining old files.');

// Keep developer tools and documentation out of the deployed website.
for (const name of ['index.html', '.nojekyll', 'THIRD_PARTY.md', 'site', 'vendor', 'assets', 'data/basemaps', 'data/sources.json']) {
  await fs.cp(path.join(root, name), path.join(destination, name), { recursive: true });
}
for (const name of ['photos', 'stories']) {
  if (await fs.stat(path.join(root, name)).catch(() => null)) {
    await fs.cp(path.join(root, name), path.join(destination, name), { recursive: true });
  }
}
const original = JSON.parse(await fs.readFile(path.join(root, 'data/places.geojson'), 'utf8'));
const published = {
  type: original.type, schemaVersion: original.schemaVersion,
  updatedOn: original.updatedOn, attribution: original.attribution,
  features: original.features.map(({ type, id, geometry, properties: p }) => ({
    type, id, geometry,
    properties: {
      name: p.name, nameEn: p.nameEn, displayName: p.displayName,
      country: p.country, countryCode: p.countryCode, region: p.region,
      category: p.category, visits: p.visits, photos: p.photos, link: p.link, note: p.note,
      sourceInput: { city: p.sourceInput?.city || p.name }
    }
  }))
};
assert.deepEqual(validatePlaces(published), validatePlaces(original));
await fs.writeFile(path.join(destination, 'data/places.geojson'), JSON.stringify(published) + '\n');
console.log(JSON.stringify({ destination, ...validatePlaces(published) }));
