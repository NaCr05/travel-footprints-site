import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Keep CMS edits separate from the canonical city and visit records.
// These bounds deliberately match the first one-city, two-photo trial.
export const pilotLimits = { albums: 1, photos: 2, bytes: 8 * 1024 * 1024 };

export function photoPath(src) {
  assert(typeof src === 'string' && /^\.\/photos\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(?:jpe?g|png|webp)$/i.test(src),
    'Photo paths must start with ./photos/ and end in .jpg, .jpeg, .png or .webp.');
  const relative = src.slice(2);
  assert(relative.split('/').every(part => part && !part.startsWith('.')), 'Invalid photo path segment.');
  return relative;
}

export function mergePhotoAlbums(places, document) {
  assert.equal(document.schemaVersion, 1, 'Unsupported photo album schema.');
  // Pages CMS removes empty arrays when saving a form.
  const albums = document.albums ?? [];
  assert(Array.isArray(albums), 'Photo albums must be an array.');
  assert(albums.length <= pilotLimits.albums, 'The pilot supports one city album.');
  const result = structuredClone(places);
  const byId = new Map(result.features.map(feature => [feature.id, feature]));
  const targets = new Set();
  for (const album of albums) {
    assert(album && typeof album === 'object', 'Invalid album.');
    const feature = byId.get(album.cityId);
    assert(feature, `Unknown album city: ${album.cityId}`);
    const when = album.when ?? '';
    assert(typeof when === 'string' && (!when || /^\d{4}-(0[1-9]|1[0-2])$/.test(when)), 'Use YYYY-MM or leave the month empty.');
    const target = when
      ? feature.properties.visits.find(visit => visit.when === when)
      : feature.properties;
    assert(target, `${album.cityId}: ${when} is not an existing visit month.`);
    const key = `${album.cityId}/${when}`;
    assert(!targets.has(key), `Duplicate album: ${key}`);
    targets.add(key);
    const entries = album.photos ?? [];
    assert(Array.isArray(entries), `${key}: photos must be an array.`);
    assert(entries.length <= pilotLimits.photos, 'The pilot supports up to two photos.');
    const seen = new Set();
    const photos = entries.map(photo => {
      assert(photo && typeof photo === 'object' && !Array.isArray(photo), 'Invalid photo entry.');
      photoPath(photo.src);
      assert(!seen.has(photo.src), `Duplicate photo: ${photo.src}`);
      seen.add(photo.src);
      const caption = photo.caption ?? '';
      assert(typeof caption === 'string', 'Photo captions must be text.');
      return { src: photo.src, caption };
    });
    if (photos.length) target.photos = [...(target.photos || []), ...photos];
  }
  return result;
}

export async function loadPlacesWithAlbums(root) {
  const places = JSON.parse(await fs.readFile(path.join(root, 'data/places.geojson'), 'utf8'));
  const document = JSON.parse(await fs.readFile(path.join(root, 'data/photo-albums.json'), 'utf8'));
  const merged = mergePhotoAlbums(places, document);
  // A bad or missing upload must fail the deployment, leaving the live map intact.
  for (const album of document.albums ?? []) {
    for (const photo of album.photos ?? []) {
      const relative = photoPath(photo.src);
      const file = path.join(root, relative);
      const info = await fs.lstat(file).catch(() => null);
      assert(info?.isFile(), `Photo file is missing or is not a regular file: ${relative}`);
      assert(info.size > 0 && info.size <= pilotLimits.bytes, `${relative}: use an image smaller than 8 MiB.`);
      const photoRoot = await fs.realpath(path.join(root, 'photos'));
      const resolved = await fs.realpath(file);
      assert(resolved.startsWith(photoRoot + path.sep), 'Photo must stay inside the photos folder.');
    }
  }
  return merged;
}
