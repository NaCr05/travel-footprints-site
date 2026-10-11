import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCitySearch, mapWishes, resolveWishVisibility, validateWishlist } from './wishlist-model.js';
import { publicationIncludes } from './wishlist-view.js';
import { createI18n } from './i18n.js';
const root = new URL('../data/cities/', import.meta.url);
const index = JSON.parse(await fs.readFile(new URL('index.json', root)));
const cities = (await Promise.all(Array.from({ length: 16 }, (_, i) => fs.readFile(new URL(`${i}.json`, root), 'utf8').then(JSON.parse)))).flat();
const search = createCitySearch(cities);
test('catalog uses unique GeoNames IDs, correct buckets, bounded files, valid coordinates and recommendations', async () => {
  assert.equal(new Set(cities.map(c => c.id)).size, cities.length);
  assert.equal(cities.length, index.count);
  for (let i = 0; i < 16; i++) {
    const bytes = await fs.readFile(new URL(`${i}.json`, root)); assert(bytes.length < 950_000);
    assert(JSON.parse(bytes).every(c => Number(c.id) % 16 === i));
  }
  for (const c of cities) { assert(c.nameEn); assert.match(c.countryCode, /^[A-Z]{2}$/); assert(c.coordinates.every(Number.isFinite)); assert(Math.abs(c.coordinates[0]) <= 180 && Math.abs(c.coordinates[1]) <= 90); }
  for (const c of index.recommended) assert.deepEqual(cities.find(row => row.id === c.id), c);
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
test('published wishlist schema and both languages stay valid', async () => {
  validateWishlist(JSON.parse(await fs.readFile(new URL('../data/wishlist.json', import.meta.url))));
  const en = createI18n('en'), zh = createI18n('zh');
  assert.equal(en.t('wishCount', { count: 3 }), '3 wishlist cities');
  assert.equal(zh.t('wishCount', { count: 3 }), '3 个愿望城市');
  assert.equal(zh.t('wishShow'), '显示愿望城市');
});
