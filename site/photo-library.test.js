import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryPhotos, groupLibraryPhotos } from './photo-library.js';
import { applyAlbumPatches } from './photo-sync.js';
import { createI18n } from './i18n.js';

const base = 'https://example.com/travel-footprints-site/';
const en = createI18n('en'), zh = createI18n('zh');
const fixtures = () => [
  { id: 'bay', properties: { name: '海湾城', nameEn: 'Bay City', countryCode: 'CN', country: '中国',
    photos: [{ src: './photos/general.jpg', caption: 'No recorded month' }],
    visits: [{ when: '2018-10', photos: [{ src: './photos/shared.jpg', caption: 'Earlier visit' }] }, { when: '2026-08', photos: ['./photos/latest.jpg'] }] } },
  { id: 'alpine', properties: { name: '山城', nameEn: 'Alpine City', countryCode: 'CH', country: '瑞士', photos: [],
    visits: [{ when: '2025-12', photos: [{ src: './photos/shared.jpg', caption: 'Another association' }] }, { when: '2026-08', photos: [] }] } },
  { id: 'empty', properties: { name: '空城', nameEn: 'Empty City', countryCode: 'CN', country: '中国', photos: [], visits: [] } }
];

test('all city and visit photos retain their own month and city association', () => {
  const photos = libraryPhotos(fixtures(), base);
  assert.equal(photos.length, 4);
  assert.deepEqual(photos.map(photo => [photo.city.id, photo.when]), [['bay', ''], ['bay', '2018-10'], ['bay', '2026-08'], ['alpine', '2025-12']]);
  assert.equal(photos[0].caption, 'No recorded month');
  assert.equal(photos[2].caption, '');
  assert.equal(photos.filter(photo => photo.src === './photos/shared.jpg').length, 2, 'A shared file must not lose its second city association');
});

test('city grouping is alphabetical with newest visits first; month grouping puts undated photos last', () => {
  const photos = libraryPhotos(fixtures(), base), cities = groupLibraryPhotos(photos, {}, en);
  assert.deepEqual(cities.map(group => group.key), ['alpine', 'bay']);
  assert.deepEqual(cities[1].photos.map(photo => photo.when), ['2026-08', '2018-10', '']);
  assert.deepEqual(groupLibraryPhotos(photos, { group: 'month' }, en).map(group => group.key), ['2026-08', '2025-12', '2018-10', '']);
});

test('city and month filters intersect without borrowing another visit date', () => {
  const photos = libraryPhotos(fixtures(), base);
  assert.equal(groupLibraryPhotos(photos, { city: 'alpine', month: '2026-08' }, en).length, 0);
  assert.equal(groupLibraryPhotos(photos, { city: 'bay', month: '2018-10', group: 'month' }, en)[0].photos[0].caption, 'Earlier visit');
  assert.deepEqual(groupLibraryPhotos(photos, { month: 'undated' }, en).flatMap(group => group.photos.map(photo => photo.when)), ['']);
  assert.deepEqual(groupLibraryPhotos([], {}, en), []);
});

test('unsafe image URLs are excluded and relative images keep the GitHub project prefix', () => {
  const features = fixtures();
  features[0].properties.photos.push('javascript:alert(1)', 'data:text/html,test', '//evil.example/test.jpg', 'file:///private.jpg');
  const photos = libraryPhotos(features, base);
  assert.equal(photos.length, 4);
  assert.equal(photos[0].url, `${base}photos/general.jpg`);
});

test('grouping never mutates source data, and removing a sibling preserves photo focus keys', () => {
  const features = fixtures(), original = structuredClone(features), photos = libraryPhotos(features, base);
  groupLibraryPhotos(photos, {}, en); groupLibraryPhotos(photos, { group: 'month' }, zh);
  assert.deepEqual(features, original);
  const oldKey = photos.find(photo => photo.src === './photos/latest.jpg').key;
  features[0].properties.photos = [];
  assert.equal(libraryPhotos(features, base).find(photo => photo.src === './photos/latest.jpg').key, oldKey);
  features[0].properties.visits[1].photos.push('./photos/latest.jpg');
  const duplicates = libraryPhotos(features, base).filter(photo => photo.src === './photos/latest.jpg');
  assert.equal(new Set(duplicates.map(photo => photo.key)).size, 2);
});

test('confirmed local additions and removals appear in the library before publication', () => {
  const features = fixtures();
  const added = applyAlbumPatches(features, [{ cityId: 'alpine', when: '2026-08', src: './photos/new.jpg', entries: [{ src: './photos/new.jpg', caption: 'Saved locally' }] }]);
  const addedPhotos = libraryPhotos(added, base);
  assert.equal(addedPhotos.length, 5);
  assert.equal(groupLibraryPhotos(addedPhotos, { city: 'alpine', month: '2026-08' }, en)[0].photos[0].caption, 'Saved locally');
  const removed = applyAlbumPatches(added, [{ cityId: 'bay', when: '', src: './photos/general.jpg', entries: [] }]);
  assert.equal(groupLibraryPhotos(libraryPhotos(removed, base), { month: 'undated' }, en).length, 0);
});

test('album navigation, filters, empty states, dates and photo counts have both languages', () => {
  const keys = ['albums', 'albumsTitle', 'albumGroupLabel', 'albumByCity', 'albumByMonth', 'albumCityFilter', 'albumMonthFilter', 'albumAllCities', 'albumAllMonths', 'backAlbums', 'albumEmptyTitle', 'albumEmptyHint', 'albumNoMatches', 'albumFilterHint'];
  for (const ui of [en, zh]) for (const key of keys) assert.equal(typeof ui.t(key), 'string');
  assert.equal(en.t('photoCount', { count: 1 }), '1 photo');
  assert.equal(en.t('photoCount', { count: 2 }), '2 photos');
  assert.equal(zh.t('photoCount', { count: 2 }), '2 张照片');
  assert.equal(en.t('albumOpenPhoto', { city: 'Bay City', month: en.month('2026-08'), number: 1 }), 'Open photo 1 · Bay City · Aug 2026');
  assert.equal(zh.t('albumOpenPhoto', { city: '海湾城', month: zh.month('2026-08'), number: 1 }), '打开第 1 张照片 · 海湾城 · 2026 年 8 月');
});
