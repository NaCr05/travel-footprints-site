import test from 'node:test';
import assert from 'node:assert/strict';
import { githubClient, readRepositoryJSON, readSnapshot } from './github.js';
import { mergePhotoAlbums } from '../site/album-model.js';

test('a valid multi-megabyte album uses raw JSON at the captured commit', async () => {
  const head = 'a'.repeat(40), calls = [];
  const places = { features: [{ id: 'rome', properties: { photos: [], visits: Array.from({ length: 128 }, (_, i) => ({ when: `${2000 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}` })) } }] };
  const albums = { schemaVersion: 1, albums: places.features[0].properties.visits.map(v => ({ cityId: 'rome', when: v.when,
    photos: Array.from({ length: 24 }, (_, i) => ({ src: `./photos/rome/${v.when}-${i}.jpg`, caption: '旅'.repeat(300) })) })) };
  assert.doesNotThrow(() => mergePhotoAlbums(places, albums));
  assert(Buffer.byteLength(JSON.stringify(albums)) > 1024 * 1024);
  const api = githubClient('synthetic-token', async (input, options) => {
    const url = new URL(input); calls.push({ url, accept: options.headers.Accept });
    if (url.pathname.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: head } });
    if (url.pathname.endsWith(`/git/commits/${head}`)) return Response.json({ tree: { sha: 'tree' } });
    assert.equal(url.searchParams.get('ref'), head);
    if (url.pathname.endsWith('places.geojson')) return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(places)).toString('base64') });
    if (options.headers.Accept === 'application/vnd.github.raw+json') return new Response(JSON.stringify(albums));
    return Response.json({ type: 'file', encoding: 'none', content: '', download_url: 'https://untrusted.invalid/file' });
  });
  const result = await readSnapshot(api, { REPOSITORY: 'example/map', BRANCH: 'main' });
  assert.deepEqual(result.albums, albums);
  assert.equal(result.head, head);
  assert.equal(calls.filter(c => c.accept === 'application/vnd.github.raw+json').length, 1);
  assert(calls.every(c => c.url.origin === 'https://api.github.com'));
});

test('invalid raw JSON fails closed and upstream authentication errors are preserved', async () => {
  for (const [response, code] of [[new Response('not JSON'), 'invalid_repository'], [new Response('', { status: 401 }), 'login_required']]) {
    const api = githubClient('synthetic-token', async (_, options) => options.headers.Accept === 'application/vnd.github.raw+json' ? response : Response.json({ type: 'file', encoding: 'none' }));
    await assert.rejects(readRepositoryJSON(api, '/repos/example/map', 'data/photo-albums.json', 'a'.repeat(40)), { code });
  }
});
