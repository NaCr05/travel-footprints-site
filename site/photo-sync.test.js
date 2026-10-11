import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoSync, savedAlbumSnapshot } from './photo-sync.js';
import { createI18n } from './i18n.js';

const old = { src: './photos/old.jpg', caption: 'Old memory' };
const added = { src: './photos/new.jpg', caption: 'New memory' };
const initial = () => ['rome', 'zakynthos-town'].map(id => ({ id, properties: { name: id, photos: [], visits: [{ when: '2026-08', photos: [{ ...old }] }, { when: '2026-07', photos: [] }] } }));
const add = (commit = 'b'.repeat(40), cityId = 'rome') => ({ commit, cityId, when: '2026-08', photos: [added], alreadySaved: false });
const remove = (src = old.src, commit = 'c'.repeat(40), cityId = 'rome') => ({ commit, cityId, when: '2026-08', removed: { src, remaining: 0 } });
const album = (features, id = 'rome', when = '2026-08') => features.find(city => city.id === id).properties.visits.find(visit => visit.when === when).photos;
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  let features = initial(), published = { features: initial(), publication: { commits: ['a'.repeat(40)] } }, time = 0, requests = 0, available = true, canCheck = true, serial = 0;
  const timers = new Map(), released = [], images = [], updates = [];
  const sync = createPhotoSync({
    getFeatures: () => features,
    onUpdate: next => { features = next; updates.push(structuredClone(next)); },
    loadPublished: async () => { requests++; return typeof published === 'function' ? published() : structuredClone(published); },
    checkPhoto: async src => { images.push(src); return available; },
    now: () => time, canCheck: () => canCheck,
    later: (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; },
    cancel: id => timers.delete(id), releaseURL: url => released.push(url), ...options
  });
  return { sync, timers, released, images, updates,
    get features() { return features; }, get requests() { return requests; },
    publish: (data, commits) => { published = { features: structuredClone(data), publication: { commits } }; },
    response: data => { published = data; }, available: value => { available = value; }, online: value => { canCheck = value; },
    advance: value => { time += value; }
  };
}

test('a confirmed save appears immediately with its local preview before any publication request', async () => {
  const f = fixture(), original = initial();
  f.sync.record(add(), [[added.src, 'blob:local-preview']]);
  assert.deepEqual(album(f.features), [old, added]);
  assert.deepEqual(album(f.features, 'zakynthos-town'), album(original, 'zakynthos-town'));
  assert.equal(f.requests, 0);
  assert.equal(f.sync.previewURL(added.src), 'blob:local-preview');
  assert.equal(f.sync.status('rome').phase, 'pending');
  assert.equal(f.timers.size, 1);
  [...f.timers.values()][0].fn(); await tick();
  assert.equal(f.requests, 1, 'The background check starts without a button click.');
  assert.equal(f.sync.status('rome').phase, 'pending');
  f.sync.dispose();
});

test('removal is immediate; a delayed or failed website never restores it', async () => {
  const f = fixture(); f.sync.record(remove());
  assert.deepEqual(album(f.features), []);
  await f.sync.check(); assert.deepEqual(album(f.features), []);
  f.response(() => { throw new Error('offline'); });
  await f.sync.check(); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'delayed');
  assert.deepEqual(album(f.features), []);
  f.sync.dispose();
});

test('a later published build proves the saved commit and releases its preview only after the image is ready', async () => {
  const f = fixture(); f.sync.record(add(), [[added.src, 'blob:preview']]);
  f.publish(f.features, ['d'.repeat(40), add().commit]);
  f.available(false); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'pending'); assert.deepEqual(f.released, []);
  f.available(true); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'published'); assert.equal(f.sync.previewURL(added.src), undefined);
  assert.deepEqual(f.released, ['blob:preview']); assert.equal(f.timers.size, 0);
  assert.deepEqual(album(f.features), [old, added]);
  f.sync.dispose();
});

test('add then remove cannot mistake the identical old website for a completed publication', async () => {
  const f = fixture(); f.sync.record(add(), [[added.src, 'blob:new']]); f.sync.record(remove(added.src));
  assert.deepEqual(album(f.features), [old]);
  await f.sync.check(); assert.equal(f.sync.status('rome').phase, 'pending');
  const intermediate = initial(); album(intermediate).push(added);
  f.publish(intermediate, [add().commit]); await f.sync.check();
  assert.deepEqual(album(f.features), [old], 'Older deployment must not resurrect the just-removed photo.');
  assert.equal(f.sync.status('rome').phase, 'pending');
  f.publish(f.features, [remove().commit, add().commit]); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'published');
  assert.deepEqual(f.released, ['blob:new']);
  f.sync.dispose();
});

test('an in-flight older check cannot overwrite a newer save or claim it was published', async () => {
  const f = fixture(); f.sync.record(add());
  const first = structuredClone(f.features);
  let resolve; f.response(() => new Promise(done => { resolve = done; }));
  const checking = f.sync.check();
  f.sync.record(remove(added.src));
  resolve({ features: first, publication: { commits: [add().commit] } }); await checking;
  assert.deepEqual(album(f.features), [old]); assert.equal(f.sync.status('rome').phase, 'pending');
  f.publish(f.features, [remove().commit, add().commit]); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'published');
  f.sync.dispose();
});

test('publication can overtake a delayed save response without displaying the photo twice', async () => {
  const f = fixture(); f.sync.record(add());
  const secondPhoto = { src: './photos/second.jpg', caption: 'Second save' };
  const second = { ...add('d'.repeat(40)), photos: [secondPhoto] };
  const website = structuredClone(f.features); album(website).push(secondPhoto);
  // Save B has reached GitHub, but this tab has not received its response yet.
  f.publish(website, [second.commit, add().commit]); await f.sync.check();
  assert.deepEqual(album(f.features), [old, added, secondPhoto]);
  f.sync.record(second, [[secondPhoto.src, 'blob:second']]);
  assert.deepEqual(album(f.features), [old, added, secondPhoto]);
  await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'published');
  assert.deepEqual(f.released, ['blob:second']);
  f.sync.dispose();
});

test('switching cities and months keeps each saved change until its own build is available', async () => {
  const f = fixture(); f.sync.record(add()); const first = structuredClone(f.features);
  f.sync.record({ ...remove(old.src, 'd'.repeat(40), 'zakynthos-town'), when: '2026-08' });
  f.sync.record({ ...add('e'.repeat(40)), when: '2026-07' });
  f.publish(first, [add().commit]); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'pending');
  assert.deepEqual(album(f.features, 'zakynthos-town'), []);
  assert.deepEqual(album(f.features, 'rome', '2026-07'), [added]);
  f.publish(f.features, ['e'.repeat(40), 'd'.repeat(40), add().commit]); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'published'); assert.equal(f.sync.status('zakynthos-town').phase, 'published');
  f.sync.dispose();
});

test('a canonical duplicate and a shared photo in another city remain after album removal', async () => {
  const f = fixture(); f.sync.record({ ...add(), photos: [old] });
  assert.equal(album(f.features).length, 2);
  f.sync.record({ ...remove(), removed: { src: old.src, remaining: 1 } });
  assert.deepEqual(album(f.features), [old]); assert.deepEqual(album(f.features, 'zakynthos-town'), [old]);
  f.publish(f.features, [remove().commit, add().commit]); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'published');
  f.sync.dispose();
});

test('publication receipts alone are insufficient when data or images do not match', async () => {
  const f = fixture(); f.sync.record(add());
  f.publish(initial(), [add().commit]); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'pending'); assert.equal(f.images.length, 0);
  f.response({ features: f.features }); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'pending', 'Legacy data has no build receipt.');
  const wrong = structuredClone(f.features); album(wrong)[1].caption = 'Wrong caption';
  f.publish(wrong, [add().commit]); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'pending');
  f.sync.dispose();
});

test('checks are bounded, never overlap, and retry does not repeat a saved write', async () => {
  const f = fixture(); f.sync.record(add());
  f.online(false); await f.sync.check(); assert.equal(f.requests, 0);
  f.online(true); f.advance(600_001); await f.sync.check();
  assert.equal(f.sync.status('rome').phase, 'delayed');
  const updates = f.updates.length;
  f.publish(f.features, [add().commit]); f.sync.retry(); await tick();
  assert.equal(f.sync.status('rome').phase, 'published'); assert.equal(f.updates.length, updates + 1);
  const g = fixture(); g.sync.record(add()); let resolve;
  g.response(() => new Promise(done => { resolve = done; }));
  const request = g.sync.check(); await g.sync.check(); g.sync.retry();
  assert.equal(g.requests, 1); resolve({ features: initial() }); await request;
  f.sync.dispose(); g.sync.dispose();
});

test('the next edit uses the confirmed commit and current album without another snapshot round trip', () => {
  const original = { head: 'a'.repeat(40), canRemove: true, albums: { schemaVersion: 1, albums: [{ cityId: 'rome', when: '2026-08', photos: [old] }] } };
  const first = savedAlbumSnapshot(original, add());
  assert.equal(first.head, add().commit); assert.equal(first.canRemove, true);
  assert.deepEqual(first.albums.albums[0].photos, [old, added]);
  assert.deepEqual(original.albums.albums[0].photos, [old]);
  assert.deepEqual(savedAlbumSnapshot(first, { ...add(), alreadySaved: true }).albums, first.albums);
  const second = savedAlbumSnapshot(first, remove());
  const last = savedAlbumSnapshot(second, remove(added.src, 'd'.repeat(40)));
  assert.deepEqual(last.albums.albums, []); assert.equal(last.head, 'd'.repeat(40));
});

test('lost-response retry does not insert a second visible photo, and general albums work', () => {
  const f = fixture(); f.sync.record(add()); f.sync.record({ ...add(), alreadySaved: true });
  assert.deepEqual(album(f.features), [old, added]);
  f.sync.record({ ...add('e'.repeat(40)), when: '' });
  assert.deepEqual(f.features[0].properties.photos, [added]);
  f.sync.record({ ...remove(added.src, 'f'.repeat(40)), when: '' });
  assert.deepEqual(f.features[0].properties.photos, []);
  f.sync.dispose();
});

test('sync status and recovery actions are present in both supported languages', () => {
  for (const language of ['en', 'zh']) for (const key of ['uploadSyncPending', 'uploadSyncDelayed', 'uploadSyncPublished', 'uploadSyncRetry']) assert.equal(typeof createI18n(language).t(key), 'string');
});
