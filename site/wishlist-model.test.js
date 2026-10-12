import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCitySearch, mapWishes, resolveWishVisibility, validateWishlist, resolveVisitedCity } from './wishlist-model.js';
import { publicationIncludes } from './wishlist-view.js';
import { createI18n } from './i18n.js';
import { cityLabels, formatCityLabels, validateCityLocales } from './city-labels.js';
const root = new URL('../data/cities/', import.meta.url);
const index = JSON.parse(await fs.readFile(new URL('index.json', root)));
const cities = (await Promise.all(Array.from({ length: 16 }, (_, i) => fs.readFile(new URL(`${i}.json`, root), 'utf8').then(JSON.parse)))).flat();
const search = createCitySearch(cities);
const locales = validateCityLocales(JSON.parse(await fs.readFile(new URL('locales.json', root))));
test('catalog uses unique GeoNames IDs, correct buckets, bounded files, valid coordinates and recommendations', async () => {
  assert.equal(new Set(cities.map(c => c.id)).size, cities.length);
  assert.equal(cities.length, index.count);
  for (let i = 0; i < 16; i++) {
    const bytes = await fs.readFile(new URL(`${i}.json`, root)); assert(bytes.length < 950_000);
    assert(JSON.parse(bytes).every(c => Number(c.id) % 16 === i));
  }
  for (const c of cities) { assert(c.nameEn); assert.match(c.countryCode, /^[A-Z]{2}$/); assert(c.coordinates.every(Number.isFinite)); assert(Math.abs(c.coordinates[0]) <= 180 && Math.abs(c.coordinates[1]) <= 90); }
  for (const c of index.recommended) assert.deepEqual(cities.find(row => row.id === c.id), c);
  assert.equal(index.localizedCitiesZh, cities.filter(c => c.nameZh).length);
  assert(index.localizedCitiesZh > 1000, 'Chinese labels extend beyond the curated destinations');
  for (const c of cities.filter(c => c.nameZh)) {
    assert.deepEqual(locales.cities[c.id], [c.nameEn, c.nameZh]);
    assert(!/[A-Za-z]/.test(c.nameZh), 'partially translated city labels use the fallback instead');
  }
  for (const [, zh] of Object.values(locales.regions)) assert(!/[A-Za-z]/.test(zh));
});
test('Chinese, English, aliases, accents and reviewed pinyin resolve without guessing same-name cities', () => {
  for (const [names, id] of [[['东京', '東京', 'Tokyo', 'dongjing'], '1850147'], [['巴黎', 'Paris'], '2988507'], [['罗马', 'Rome'], '3169070'], [["Xi'an", '西安', 'xian'], '1790630']]) {
    for (const name of names) assert.equal(search(name)[0]?.id, id, name);
  }
  assert(search('Paris').length > 1);
  assert(search('Paris').every(c => c.countryCode && c.region));
  assert(search('Bei', 'CN').every(c => ['CN', 'HK', 'MO'].includes(c.countryCode)));
  assert(search('Tokyo', 'other').every(c => !['CN', 'HK', 'MO'].includes(c.countryCode)));
  assert.equal(search('zzzznotacity').length, 0);
  assert.equal(search('').length, 0);
});
test('wish visibility defaults on, remembers off, does not mutate data, and deduplicates visited wishes', () => {
  for (const value of [undefined, null, '', 'true']) assert.equal(resolveWishVisibility(value), true);
  assert.equal(resolveWishVisibility('false'), false);
  const wishes = [{ id: '1', visitedId: 'rome' }, { id: '2' }], original = JSON.stringify(wishes), visited = [{ id: 'rome' }];
  assert.deepEqual(mapWishes(wishes, visited, false), { extra: [], revisits: new Map() });
  assert.deepEqual(mapWishes(wishes, visited, true).extra, [wishes[1]]);
  assert.equal(mapWishes(wishes, visited, true).revisits.get('rome'), wishes[0]);
  assert.equal(mapWishes(wishes, [], true).extra.length, 2);
  assert.equal(JSON.stringify(wishes), original);
});
test('wish publication accepts the confirmed commit or a descendant receipt, never stale data', () => {
  const commit = 'a'.repeat(40);
  assert.equal(publicationIncludes({ publication: { commits: ['b'.repeat(40), commit] } }, commit), true);
  for (const doc of [{}, { publication: { commits: ['b'.repeat(40)] } }]) assert.equal(publicationIncludes(doc, commit), false);
});

test('visited state comes from the current map, not a baked catalog hint', () => {
  const rome = search('Rome').find(c => c.id === '3169070');
  const places = [{ id: 'my-rome', geometry: { coordinates: [...rome.coordinates] }, properties: { nameEn: 'Rome', countryCode: 'IT' } }];
  const before = JSON.stringify(rome);
  assert.equal(resolveVisitedCity(rome, []).visitedId, undefined);
  assert.equal(resolveVisitedCity({ ...rome, visitedId: undefined }, places).visitedId, 'my-rome');
  const shifted = structuredClone(places[0]); shifted.geometry.coordinates = [-80, 30];
  assert.equal(resolveVisitedCity(rome, [shifted]).visitedId, undefined);
  assert.equal(JSON.stringify(rome), before);
});
test('published wishlist schema and both languages stay valid', async () => {
  validateWishlist(JSON.parse(await fs.readFile(new URL('../data/wishlist.json', import.meta.url))));
  const en = createI18n('en'), zh = createI18n('zh');
  assert.equal(en.t('wishCount', { count: 3 }), '3 wishlist cities');
  assert.equal(zh.t('wishCount', { count: 3 }), '3 个愿望城市');
  assert.equal(zh.t('wishShow'), '显示愿望城市');
});

test('non-curated search, legacy wishes and regions use the selected language by ID', () => {
  const legacy = { id: '2867714', nameEn: 'Munich', nameZh: '', countryCode: 'DE', region: 'Bavaria', coordinates: [11.57549, 48.13743], reason: 'A personal reason, kept verbatim.', createdAt: '2026-10-11T05:16:22.893Z', updatedAt: '2026-10-11T05:16:22.893Z' };
  const before = structuredClone(legacy), en = createI18n('en'), zh = createI18n('zh');
  assert.equal(search('慕尼黑')[0]?.id, legacy.id);
  assert.equal(search('Munich')[0]?.id, legacy.id);
  for (const [query, id] of [['苏黎世', '2657896'], ['爱丁堡', '2650225']]) assert.equal(search(query)[0]?.id, id);
  assert.equal(formatCityLabels(legacy, zh, locales).name, '慕尼黑');
  assert.match(formatCityLabels(legacy, zh, locales).place, /^德国 \/ .*巴伐利亚/);
  assert.equal(formatCityLabels(legacy, en, locales).name, 'Munich');
  assert.equal(formatCityLabels(legacy, en, locales).place, 'Germany / Bavaria');
  assert.deepEqual(formatCityLabels(legacy, zh, locales), formatCityLabels(search('Munich')[0], zh, locales));
  assert.deepEqual(legacy, before, 'translation must not edit a saved wish');
  for (const id of ['1850147', '2988507']) {
    const idea = index.recommended.find(c => c.id === id), found = search(idea.nameEn).find(c => c.id === id);
    for (const ui of [en, zh]) assert.deepEqual(formatCityLabels(idea, ui, locales), formatCityLabels(found, ui, locales));
    assert(!/[A-Za-z]/.test(formatCityLabels(idea, zh, locales).place), 'country and region are Chinese too');
    assert(!/[\u3400-\u9fff]/.test(JSON.stringify(formatCityLabels(idea, en, locales))));
  }
});

test('missing translations retain original names with an explicit note, never guessed Han aliases', () => {
  const city = { id: '9999999999', nameEn: 'Example Town', nameZh: '', countryCode: 'US', region: 'Example Region', aliases: ['架空别名'] };
  const zh = createI18n('zh'), en = createI18n('en');
  assert.deepEqual(formatCityLabels(city, zh, locales), { name: 'Example Town（暂无中文译名）', place: '美国 / Example Region（暂无中文译名）' });
  assert.deepEqual(formatCityLabels(city, en, locales), { name: 'Example Town', place: 'United States / Example Region' });
  assert.equal(formatCityLabels(city, zh, null).name, 'Example Town（译名暂不可用）', 'network failure is not missing source data');
  assert.equal(cityLabels({ ...city, region: '' }, 'zh', locales).missingRegion, false);
  for (const invalid of [null, { schemaVersion: 1, cities: [], regions: {} }, { schemaVersion: 1, cities: { 1: ['English'] }, regions: {} }]) assert.throws(() => validateCityLocales(invalid));
});
