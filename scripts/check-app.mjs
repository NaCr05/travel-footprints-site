import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterPlaces, timelineGroups, safeAssetURL, photoEntries } from '../site/model.js';
import { createI18n, resolveLanguage, DEFAULT_LANGUAGE } from '../site/i18n.js';
import { toDisplayCoordinates, projectCountries } from '../site/projection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Fictional fixtures keep model regressions stable when the owner adds real cities.
const place = (id, countryCode, name, nameEn, category, months, alias=name) => ({
  type:'Feature', id, geometry:{ type:'Point', coordinates:[0,0] },
  properties:{ name, nameEn, country:countryCode, countryCode, region:'', category,
    visits:months.map(when=>({when,precision:'month'})), photos:[], link:null, sourceInput:{city:alias} }
});
const places = [
  place('home-city','CN','示例居住地','Home City','residence',[]),
  place('island-city','CN','示例岛城','Island City','visited',['2018-10','2025-12'],'示例岛'),
  place('bay-city','MY','示例海湾城','Bay City','visited',['2025-12']),
  place('frequent-city','CN','示例常去地','Frequent City','frequent',[])
];
const f = id => places.find(feature => feature.id === id);
// Geographic latitude must have uniform spacing on the finished world map.
// Test through the Mercator renderer's y formula, not the adapter's inverse.
for (const latitude of [-90, -60, -30, 0, 30, 60, 90]) {
  const [longitude, displayLatitude] = toDisplayCoordinates([118.08187, latitude]);
  const mercatorY = Math.log(Math.tan(Math.PI / 4 + displayLatitude * Math.PI / 360));
  assert(Math.abs(mercatorY - latitude * Math.PI / 180) < 1e-12);
  assert.equal(longitude, 118.08187);
}
const countries = JSON.parse(await fs.readFile(path.join(root, 'data/basemaps/world-50m.geojson'), 'utf8'));
const before = JSON.stringify(countries);
const displayCountries = projectCountries(countries);
assert.equal(JSON.stringify(countries), before, 'display projection must not mutate geographic source');
assert.equal(displayCountries.features.length, countries.features.length);
assert.equal(filterPlaces(places).length, 4);
assert.equal(filterPlaces(places, { country: 'CN' }).length, 3);
assert.equal(filterPlaces(places, { query: '示例岛' })[0].id, 'island-city');
assert.equal(filterPlaces(places, { query: '  BAY CITY ' })[0].id, 'bay-city');
assert.deepEqual(filterPlaces(places, { year: '2018', country: 'CN' }).map(p => p.id), ['island-city']);
assert(!filterPlaces(places, { year: '2025' }).some(f => f.properties.category !== 'visited'));
assert.equal(timelineGroups([f('island-city')]).length, 2);
assert.deepEqual(timelineGroups([f('island-city')], '2025').map(([month]) => month), ['2025-12']);
assert.equal(timelineGroups([f('home-city')]).length, 0);
assert.equal(timelineGroups(places).reduce((n, [, group]) => n + group.length, 0), 3);
const en = createI18n(), zh = createI18n('zh');
assert.equal(DEFAULT_LANGUAGE, 'en');
for (const saved of [null, undefined, '', 'invalid', 'en']) assert.equal(resolveLanguage(saved), 'en');
assert.equal(resolveLanguage('zh'), 'zh');
assert.equal(en.visits(f('home-city').properties), 'Lived in · Month not recorded');
assert.equal(zh.visits(f('home-city').properties), '常住 · 未记录具体月份');
assert.equal(en.visits(f('island-city').properties), 'Oct 2018 · Dec 2025');
assert.equal(zh.visits(f('island-city').properties), '2018 年 10 月 · 2025 年 12 月');
assert.equal(en.summary(1, 1), '1 city · 1 country');
assert.equal(en.summary(2, 2), '2 cities · 2 countries');
assert.equal(zh.summary(2, 2), '2 座城市 · 2 个国家');
assert.equal(en.city(f('bay-city').properties), 'Bay City');
assert.equal(zh.city(f('bay-city').properties), '示例海湾城');
assert.equal(en.country(f('bay-city').properties), 'Malaysia');
assert.deepEqual(filterPlaces(places, { query: 'malaysia', language: 'zh' }).map(p => p.id), ['bay-city']);
f('home-city').properties.region = '福建';
assert.deepEqual(filterPlaces(places, { query: 'fujian' }).map(p => p.id), ['home-city']);
assert.deepEqual(filterPlaces(places, { query: '福建', language: 'en' }).map(p => p.id), ['home-city']);
const records = JSON.parse(await fs.readFile(path.join(root, 'data/places.geojson'), 'utf8'));
const originalRecords = JSON.stringify(records);
for (const { properties: p } of records.features) {
  assert(!/[\u3400-\u9fff]/u.test(`${en.city(p)} ${en.location(p)}`), `Missing English place translation: ${p.name}`);
  for (const locale of [en, zh]) { locale.visits(p); locale.location(p); locale.alias(p); }
}
assert.equal(JSON.stringify(records), originalRecords, 'Localizing must preserve source records');
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
assert(html.includes('<html lang="en">'));
for (const [, key] of html.matchAll(/data-i18n(?:-label|-title|-placeholder)?="([a-zA-Z]+)"/g)) {
  for (const locale of [en, zh]) assert.equal(typeof locale.t(key), 'string');
}
const base = 'https://example.com/travel-footprints/';
for (const invalid of ['javascript:alert(1)', '  JAVASCRIPT:alert(1)', 'data:text/html,hi', '//evil.test/photo.jpg', 'file:///C:/secret', String.fromCharCode(92) + 'evil.test']) assert.equal(safeAssetURL(invalid, base), null);
assert.equal(safeAssetURL('./photos/rome.jpg', base), `${base}photos/rome.jpg`);
assert.equal(safeAssetURL('https://example.org/story', base), 'https://example.org/story');
assert.deepEqual(photoEntries({ photos: ['photos/city.jpg'], visits: [{ when: '2026-08', photos: [{ src: './photos/day.jpg', caption: 'Caption' }] }] }), [{ src: 'photos/city.jpg', caption: '', when: '' }, { src: './photos/day.jpg', caption: 'Caption', when: '2026-08' }]);
for (const filename of ['index.html', 'site/app.js', 'site/styles.css', 'site/model.js', 'site/i18n.js', 'site/projection.js', 'site/mark.svg', 'vendor/maplibre/maplibre-gl.mjs', 'vendor/maplibre/maplibre-gl-worker.mjs', 'vendor/maplibre/maplibre-gl.css', 'vendor/maplibre/LICENSE.txt', '.nojekyll']) await fs.access(path.join(root, filename));
console.log(JSON.stringify({ result: 'PASS', checks: ['uniform latitude spacing in world display', 'source geometry remains unchanged', 'country/year/search filters', 'repeated visit months', 'unknown dates stay undated', 'timeline entries preserved', 'English default and saved Chinese preference', 'bilingual names, regions, months and pluralization', 'bilingual search and unchanged source records', 'photo and story URL handling', 'relative paths under GitHub project prefix', 'bundled runtime assets'] }));
