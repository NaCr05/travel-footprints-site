import assert from 'node:assert/strict';

export function validatePlaces(data) {
  assert.equal(data.type, 'FeatureCollection');
  assert.equal(data.schemaVersion, 1);
  const ids = new Set();
  const countries = new Set();
  let datedPlaces = 0;
  let monthEntries = 0;
  const categories = { residence: 0, frequent: 0, visited: 0 };
  const months = [];
  for (const f of data.features) {
    assert.equal(f.type, 'Feature');
    assert.equal(f.geometry.type, 'Point');
    assert.match(f.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert(!ids.has(f.id), `Duplicate id: ${f.id}`);
    ids.add(f.id);
    const [lon, lat] = f.geometry.coordinates;
    assert.equal(f.geometry.coordinates.length, 2);
    assert(Number.isFinite(lon) && lon >= -180 && lon <= 180);
    assert(Number.isFinite(lat) && lat >= -90 && lat <= 90);
    const p = f.properties;
    assert(p.name && p.country && p.countryCode);
    countries.add(p.countryCode);
    assert(Object.hasOwn(categories, p.category));
    categories[p.category]++;
    assert(Array.isArray(p.visits));
    const placeMonths = new Set();
    for (const visit of p.visits) {
      assert.equal(visit.precision, 'month');
      assert.match(visit.when, /^\d{4}-(0[1-9]|1[0-2])$/);
      assert(!placeMonths.has(visit.when), `Duplicate month: ${f.id}/${visit.when}`);
      placeMonths.add(visit.when);
      months.push(visit.when);
    }
    if (p.visits.length) datedPlaces++;
    monthEntries += p.visits.length;
    assert(Array.isArray(p.photos));
    assert(p.link === null || /^(https?:\/\/|\.\/)/.test(p.link));
  }
  months.sort();
  return {
    places: ids.size, countries: countries.size, datedPlaces, monthEntries,
    categories, dateRange: [months[0] ?? null, months.at(-1) ?? null],
    countryCounts: Object.fromEntries([...countries].map(code => [code, data.features.filter(f => f.properties.countryCode === code).length]))
  };
}
