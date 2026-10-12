import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validatePlaces } from './data.mjs';
import { loadPlacesWithAlbums } from './albums.mjs';
import { publicPlaces, publicWishlist, copyPublicFiles } from './public-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] || path.join(root, 'dist'));
assert(destination !== root, 'Export into a separate empty directory.');
await fs.mkdir(destination, { recursive: true });
assert.equal((await fs.readdir(destination)).length, 0, 'Use an empty export directory to avoid retaining old files.');

const original = await loadPlacesWithAlbums(root);
const published = publicPlaces(original);
await copyPublicFiles(root, destination, published);
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
const wishlist = publicWishlist(JSON.parse(await fs.readFile(path.join(root, 'data/wishlist.json'), 'utf8')));
await fs.writeFile(path.join(destination, 'data/wishlist.json'), JSON.stringify({ ...wishlist, publication: published.publication }) + '\n');
console.log(JSON.stringify({ destination, ...validatePlaces(published) }));
