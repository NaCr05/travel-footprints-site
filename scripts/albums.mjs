import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { albumLimits, mergePhotoAlbums, photoPath } from '../site/album-model.js';
export { albumLimits, mergePhotoAlbums, photoPath };

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
      assert(info.size > 0 && info.size <= albumLimits.bytes, `${relative}: use an image smaller than 8 MiB.`);
      const photoRoot = await fs.realpath(path.join(root, 'photos'));
      const resolved = await fs.realpath(file);
      assert(resolved.startsWith(photoRoot + path.sep), 'Photo must stay inside the photos folder.');
    }
  }
  return merged;
}
