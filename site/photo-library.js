import { photoEntries, safeAssetURL } from './model.js';

// Dates belong to an album association, not the file or the city's latest visit.
export function libraryPhotos(features, base) {
  return features.flatMap(city => {
    const occurrences = new Map();
    return photoEntries(city.properties).flatMap(photo => {
      const url = safeAssetURL(photo.src, base);
      const association = JSON.stringify([city.id, photo.when, photo.src]);
      const occurrence = occurrences.get(association) || 0;
      occurrences.set(association, occurrence + 1);
      return url ? [{ ...photo, city, url, key: JSON.stringify([association, occurrence]) }] : [];
    });
  });
}

export function groupLibraryPhotos(photos, { city = 'all', month = 'all', group = 'city' } = {}, ui) {
  const matching = photos.filter(photo => (city === 'all' || photo.city.id === city) &&
    (month === 'all' || photo.when === (month === 'undated' ? '' : month)));
  const groups = new Map();
  for (const photo of matching) {
    const key = group === 'month' ? photo.when : photo.city.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(photo);
  }
  const compareCity = (a, b) => ui.city(a.city.properties).localeCompare(ui.city(b.city.properties), ui.language === 'zh' ? 'zh-CN' : 'en');
  return [...groups].sort(([a, left], [b, right]) => group === 'month' ? b.localeCompare(a) : compareCity(left[0], right[0]))
    .map(([key, entries]) => ({ key, photos: entries.sort((a, b) => group === 'month' ? compareCity(a, b) : b.when.localeCompare(a.when)) }));
}
