// Shared by the static build and the authenticated upload service.
export const albumLimits = Object.freeze({ albums: 128, photos: 24, bytes: 8 * 1024 * 1024, caption: 300 });
export const uploadLimits = Object.freeze({ batch: 5, inputBytes: 20 * 1024 * 1024, bytes: 2 * 1024 * 1024, side: 1920, pixels: 60_000_000 });
function requireValue(condition, message) { if (!condition) throw new Error(message); }

export function photoPath(src) {
  requireValue(typeof src === 'string' && /^\.\/photos\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(?:jpe?g|png|webp)$/i.test(src),
    'Photo paths must start with ./photos/ and end in .jpg, .jpeg, .png or .webp.');
  const relative = src.slice(2);
  requireValue(relative.split('/').every(part => part && !part.startsWith('.')), 'Invalid photo path segment.');
  return relative;
}

// Verify the scoped album, not an image 404: another album may keep the file.
export function albumChangePublished(places, cityId, change) {
  const city = places?.features?.find(feature => feature.id === cityId);
  const target = change.when ? city?.properties.visits.find(visit => visit.when === change.when) : city?.properties;
  if (!target) return false;
  const entries = (target.photos || []).map(photo => typeof photo === 'string' ? { src: photo } : photo);
  if (change.removed) return entries.filter(photo => photo.src === change.removed.src).length === change.removed.remaining;
  return change.photos.every(photo => entries.some(entry => entry.src === photo.src));
}

export function mergePhotoAlbums(places, document) {
  requireValue(document?.schemaVersion === 1, 'Unsupported photo album schema.');
  const albums = document.albums ?? [];
  requireValue(Array.isArray(albums), 'Photo albums must be an array.');
  requireValue(albums.length <= albumLimits.albums, 'Too many city albums.');
  const result = structuredClone(places);
  const byId = new Map(result.features.map(feature => [feature.id, feature]));
  const targets = new Set();
  for (const album of albums) {
    requireValue(album && typeof album === 'object', 'Invalid album.');
    const feature = byId.get(album.cityId);
    requireValue(feature, `Unknown album city: ${album.cityId}`);
    const when = album.when ?? '';
    requireValue(typeof when === 'string' && (!when || /^\d{4}-(0[1-9]|1[0-2])$/.test(when)), 'Use YYYY-MM or leave the month empty.');
    const target = when ? feature.properties.visits.find(visit => visit.when === when) : feature.properties;
    requireValue(target, `${album.cityId}: ${when} is not an existing visit month.`);
    const key = `${album.cityId}/${when}`;
    requireValue(!targets.has(key), `Duplicate album: ${key}`);
    targets.add(key);
    const entries = album.photos ?? [];
    requireValue(Array.isArray(entries), `${key}: photos must be an array.`);
    requireValue(entries.length <= albumLimits.photos, `An album supports up to ${albumLimits.photos} photos.`);
    const seen = new Set();
    const photos = entries.map(photo => {
      requireValue(photo && typeof photo === 'object' && !Array.isArray(photo), 'Invalid photo entry.');
      photoPath(photo.src);
      requireValue(!seen.has(photo.src), `Duplicate photo: ${photo.src}`);
      seen.add(photo.src);
      const caption = photo.caption ?? '';
      requireValue(typeof caption === 'string' && caption.length <= albumLimits.caption, `Photo captions must be text of at most ${albumLimits.caption} characters.`);
      return { src: photo.src, caption };
    });
    if (photos.length) target.photos = [...(target.photos || []), ...photos];
  }
  return result;
}
