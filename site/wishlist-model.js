export const wishLimits = Object.freeze({ count: 500, reason: 500 });
export const WISH_VISIBILITY_KEY = 'footprints-wishlist-visible-v1';
export const resolveWishVisibility = value => value !== 'false';
export const normalizeCityQuery = value => String(value || '').normalize('NFKD').toLocaleLowerCase().replace(/[\u0300-\u036f\s'’·.-]/g, '');

export function validateWishlist(doc) {
  if (doc?.schemaVersion !== 1 || !Array.isArray(doc.cities) || doc.cities.length > wishLimits.count) throw new Error('invalid_wishlist');
  const ids = new Set();
  for (const c of doc.cities) {
    if (!/^[1-9]\d{0,9}$/.test(c.id || '') || ids.has(c.id)) throw new Error('invalid_wishlist');
    ids.add(c.id);
    for (const key of ['nameEn', 'nameZh', 'region']) if (typeof c[key] !== 'string' || c[key].length > 200) throw new Error('invalid_wishlist');
    if (!c.nameEn || !/^[A-Z]{2}$/.test(c.countryCode || '') || typeof c.reason !== 'string' || c.reason.length > wishLimits.reason) throw new Error('invalid_wishlist');
    if (!Array.isArray(c.coordinates) || c.coordinates.length !== 2 || !c.coordinates.every(Number.isFinite) || Math.abs(c.coordinates[0]) > 180 || Math.abs(c.coordinates[1]) > 90) throw new Error('invalid_wishlist');
    for (const key of ['createdAt', 'updatedAt']) if (typeof c[key] !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(c[key]) || !Number.isFinite(Date.parse(c[key]))) throw new Error('invalid_wishlist');
    if (c.visitedId != null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.visitedId)) throw new Error('invalid_wishlist');
  }
  return doc;
}

export function createCitySearch(cities) {
  const prepared = cities.map(city => ({ city, names: [...new Set([city.nameEn, city.nameZh, ...city.aliases || []].filter(Boolean).map(normalizeCityQuery))] }));
  return (query, country = 'all', limit = 30) => {
    const q = normalizeCityQuery(query);
    if (!q) return [];
    const found = [];
    for (const { city, names } of prepared) {
      const isChina = ['CN', 'HK', 'MO'].includes(city.countryCode);
      if (country === 'CN' && !isChina || country === 'other' && isChina) continue;
      const rank = names.some(n => n === q) ? 0 : names.some(n => n.startsWith(q)) ? 1 : q.length >= 3 && names.some(n => n.includes(q)) ? 2 : 9;
      if (rank < 9) found.push({ city, rank });
    }
    return found.sort((a, b) => a.rank - b.rank || (b.city.population || 0) - (a.city.population || 0) || a.city.id.localeCompare(b.city.id)).slice(0, limit).map(x => x.city);
  };
}

export function wishFeature(city) {
  return { type: 'Feature', id: `wish-${city.id}`, geometry: { type: 'Point', coordinates: city.coordinates }, properties: { name: city.nameZh || city.nameEn, nameEn: city.nameEn, countryCode: city.countryCode, country: '', region: city.region, wish: city } };
}

// A catalog hint is not a travel record. Reconcile it against the current map,
// using both names and nearby coordinates so same-name cities stay distinct.
export function resolveVisitedCity(city, places) {
  if (!city) return city;
  const { visitedId, ...rest } = city;
  const names = new Set([city.nameEn, city.nameZh, ...city.aliases || []].filter(Boolean).map(normalizeCityQuery));
  const match = places.map(f => {
    const p = f.properties;
    const sameCountry = p.countryCode === city.countryCode || p.countryCode === 'CN' && ['HK', 'MO'].includes(city.countryCode);
    const distance = (f.geometry.coordinates[0] - city.coordinates[0]) ** 2 + (f.geometry.coordinates[1] - city.coordinates[1]) ** 2;
    const sameName = [p.name, p.nameEn, p.sourceInput?.city].filter(Boolean).some(n => names.has(normalizeCityQuery(n)));
    return { f, distance, matches: sameCountry && distance < .01 && sameName };
  }).filter(item => item.matches).sort((a, b) => a.distance - b.distance)[0];
  return match ? { ...rest, visitedId: match.f.id } : rest;
}

// A visited city has one clickable marker, even when it is on the wishlist.
export function mapWishes(cities, visiblePlaces, enabled) {
  if (!enabled) return { extra: [], revisits: new Map() };
  const visibleIds = new Set(visiblePlaces.map(f => f.id));
  return { extra: cities.filter(c => !c.visitedId || !visibleIds.has(c.visitedId)), revisits: new Map(cities.filter(c => c.visitedId && visibleIds.has(c.visitedId)).map(c => [c.visitedId, c])) };
}
