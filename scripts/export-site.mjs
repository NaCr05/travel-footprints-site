import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validatePlaces } from './data.mjs';
import { loadPlacesWithAlbums } from './albums.mjs';
import { validateWishlist } from '../site/wishlist-model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] || path.join(root, 'dist'));
assert(destination !== root, 'Export into a separate empty directory.');
await fs.mkdir(destination, { recursive: true });
assert.equal((await fs.readdir(destination)).length, 0, 'Use an empty export directory to avoid retaining old files.');

// Keep developer tools and documentation out of the deployed website.
for (const name of ['index.html', '.nojekyll', 'THIRD_PARTY.md', 'site', 'vendor', 'assets', 'data/basemaps', 'data/sources.json', 'data/cities']) {
  await fs.cp(path.join(root, name), path.join(destination, name), { recursive: true, filter: source => !source.endsWith('.test.js') });
}
for (const name of ['photos', 'stories']) {
  if (await fs.stat(path.join(root, name)).catch(() => null)) {
    await fs.cp(path.join(root, name), path.join(destination, name), { recursive: true });
  }
}
const original = await loadPlacesWithAlbums(root);
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
// Include only public commit IDs, never credentials or local paths. Descendants
// can confirm earlier edits even when Actions skips an intermediate queued build.
try {
  const commits = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'log', '-64', '--format=%H'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\r?\n/);
  assert(commits.length && commits.every(sha => /^[a-f0-9]{40}$/.test(sha)), 'Invalid publication commits.');
  published.publication = { commits };
} catch (error) {
  if (process.env.GITHUB_ACTIONS === 'true') throw error;
  published.publication = { commits: [] };
}
assert.deepEqual(validatePlaces(published), validatePlaces(original));
await fs.writeFile(path.join(destination, 'data/places.geojson'), JSON.stringify(published) + '\n');
const wishlist = validateWishlist(JSON.parse(await fs.readFile(path.join(root, 'data/wishlist.json'), 'utf8')));
await fs.writeFile(path.join(destination, 'data/wishlist.json'), JSON.stringify({ ...wishlist, publication: published.publication }) + '\n');
console.log(JSON.stringify({ destination, ...validatePlaces(published) }));
