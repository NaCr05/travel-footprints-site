import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.js';
import { seal, unseal, base64, unbase64 } from './crypto.js';
import { cleanJPEG } from './images.js';
import { uploadMessages } from '../site/upload-i18n.js';

// An 8 x 6 synthetic single-color JPEG. No personal photos or credentials.
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnaKKK+mPgj//Z';
const env = { SITE_ORIGIN: 'https://map.example', SERVICE_ORIGIN: 'https://uploads.example', REPOSITORY: 'example/map', REPOSITORY_ID: '2', OWNER_ID: '1', BRANCH: 'main', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', SESSION_SECRET: 'this-is-a-test-secret-only-never-use-it-for-a-deployment-123' };
const head = 'a'.repeat(40), next = 'b'.repeat(40);
const places = { type: 'FeatureCollection', features: [
  { id: 'rome', properties: { visits: [{ when: '2026-08' }], photos: [] } },
  { id: 'other-city', properties: { visits: [], photos: [] } }
] };
const body = { base: head, cityId: 'rome', when: '2026-08', photos: [{ content: jpeg, caption: 'A synthetic test image' }] };
const session = await seal({ token: 'ghu_test_never_real', id: 1, exp: Date.now() + 60_000 }, env.SESSION_SECRET, 'session');
const request = (path, payload, token = session, origin = env.SITE_ORIGIN) => new Request(env.SERVICE_ORIGIN + path, { method: payload ? 'POST' : 'GET', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });

function upstream({ owner = 1, push = true, repositoryId = 2, race = false, stale = false, loseResponse = false } = {}) {
  let currentHead = stale ? next : head, albums = { schemaVersion: 1, albums: [] }, tree = null;
  const calls = [], writes = [];
  const respond = data => Response.json(data);
  const fetcher = async (input, options = {}) => {
    const url = new URL(input), path = url.pathname, method = options.method || 'GET', payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, payload }); if (method !== 'GET') writes.push({ path, method, payload });
    if (url.href === 'https://github.com/login/oauth/access_token') return respond({ access_token: 'ghu_test_never_real', expires_in: 28_800 });
    assert.equal(url.origin, 'https://api.github.com');
    if (path === '/user') return respond({ id: owner, login: 'example-owner' });
    if (path === '/repos/example/map') return respond({ id: repositoryId, permissions: { push } });
    if (path.endsWith('/git/ref/heads/main')) return respond({ object: { sha: currentHead } });
    if (path.includes('/contents/')) {
      assert.equal(url.searchParams.get('ref'), currentHead);
      const value = path.endsWith('places.geojson') ? places : albums;
      return respond({ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64') });
    }
    if (path.includes('/git/commits/') && method === 'GET') return respond({ tree: { sha: 'tree-before' } });
    if (path.endsWith('/git/blobs')) return respond({ sha: 'new-image-blob' });
    if (path.endsWith('/git/trees')) { tree = payload; return respond({ sha: 'tree-after' }); }
    if (path.endsWith('/git/commits')) { assert.deepEqual(payload.parents, [head]); return respond({ sha: next }); }
    if (path.endsWith('/git/refs/heads/main')) {
      assert.equal(payload.force, false);
      if (race) return respondError(422);
      albums = JSON.parse(tree.tree.find(file => file.path === 'data/photo-albums.json').content); currentHead = next;
      if (loseResponse) { loseResponse = false; throw new Error('Lost response after successful write'); }
      return respond({ object: { sha: next } });
    }
    if (path === '/applications/test-client/token' && method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected mock request: ${method} ${path}`);
  };
  return { fetcher, calls, writes, get albums() { return albums; }, get currentHead() { return currentHead; } };
}
const respondError = status => Response.json({ message: 'Simulated upstream failure' }, { status });

test('JPEG metadata is removed; oversized dimensions and malformed/truncated files fail', () => {
  const original = unbase64(jpeg), text = new TextEncoder().encode('Exif\0\0GPS-private-fixture');
  const segment = new Uint8Array([0xff, 0xe1, 0, text.length + 2, ...text]);
  const withMetadata = new Uint8Array([...original.subarray(0, 2), ...segment, ...original.subarray(2)]);
  const clean = cleanJPEG(base64(withMetadata));
  assert(!new TextDecoder().decode(clean).includes('GPS-private-fixture'));
  assert.deepEqual(clean, cleanJPEG(jpeg));
  assert.deepEqual(cleanJPEG(base64(clean)), clean);
  for (const invalid of ['<svg/>', '', base64(original.subarray(0, 40)), 'AAAA']) assert.throws(() => cleanJPEG(invalid));
  const huge = original.slice(); const frame = huge.findIndex((byte, index) => byte === 0xff && huge[index + 1] === 0xc0);
  huge[frame + 7] = 0x7f; huge[frame + 8] = 0xff;
  assert.throws(() => cleanJPEG(base64(huge)));
});

test('encrypted sessions reject expiry, tampering, and cross-purpose tokens', async () => {
  assert.equal((await unseal(session, env.SESSION_SECRET, 'session')).id, 1);
  await assert.rejects(unseal(session, env.SESSION_SECRET, 'login'));
  await assert.rejects(unseal(session, env.SESSION_SECRET, 'session', Date.now() + 120_000));
  await assert.rejects(unseal(session.slice(0, -3) + 'XYZ', env.SESSION_SECRET, 'session'));
});

test('unconfigured, anonymous and cross-origin requests cannot reach GitHub', async () => {
  let count = 0; const fetcher = async () => { count++; throw new Error('Must not call upstream'); };
  assert.equal((await handleRequest(request('/api/photos', body), {}, fetcher)).status, 503);
  assert.equal((await handleRequest(request('/api/photos', body, ''), env, fetcher)).status, 401);
  const hostile = await handleRequest(request('/api/photos', body, session, 'https://evil.example'), env, fetcher);
  assert.equal(hostile.status, 403); assert.equal(hostile.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(count, 0);
  const preflight = await handleRequest(new Request(env.SERVICE_ORIGIN + '/api/photos', { method: 'OPTIONS', headers: { Origin: env.SITE_ORIGIN } }), env, fetcher);
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), env.SITE_ORIGIN);
});

test('owner ID, repository ID and current push permission are checked before writing', async () => {
  for (const settings of [{ owner: 99 }, { push: false }, { repositoryId: 999 }]) {
    const mock = upstream(settings);
    assert.equal((await handleRequest(request('/api/photos', body), env, mock.fetcher)).status, 403);
    assert.equal(mock.writes.length, 0);
  }
});

test('OAuth uses PKCE and a state cookie; forged callbacks never exchange a code', async () => {
  const nonce = 'n'.repeat(43), mock = upstream();
  const start = await handleRequest(new Request(`${env.SERVICE_ORIGIN}/auth/start?nonce=${nonce}`), env, mock.fetcher);
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('Location'));
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.match(start.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const cookies = start.headers.get('Set-Cookie').split(';')[0];
  const forged = await handleRequest(new Request(`${env.SERVICE_ORIGIN}/auth/callback?state=wrong&code=test`, { headers: { Cookie: cookies } }), env, mock.fetcher);
  assert.match(await forged.text(), /login_failed/); assert.equal(mock.calls.length, 0);
  const success = await handleRequest(new Request(`${env.SERVICE_ORIGIN}/auth/callback?state=${auth.searchParams.get('state')}&code=test`, { headers: { Cookie: cookies } }), env, mock.fetcher);
  const html = await success.text();
  assert(!html.includes('ghu_test_never_real')); assert(!html.includes(env.GITHUB_CLIENT_SECRET));
  assert(html.includes('example-owner')); assert(html.includes(env.SITE_ORIGIN));
  const exchange = mock.calls[0].payload;
  assert.equal(exchange.repository_id, env.REPOSITORY_ID); assert.equal(exchange.code_verifier.length, 43);
  assert.match(success.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('one save commits image and manifest together and never changes city records', async () => {
  const before = JSON.stringify(places), mock = upstream();
  const result = await handleRequest(request('/api/photos', { ...body, path: '.github/workflows/evil.yml', branch: 'other-branch' }), env, mock.fetcher);
  assert.equal(result.status, 200); const data = await result.json(); assert.equal(data.commit, next);
  const tree = mock.writes.find(call => call.path.endsWith('/git/trees')).payload;
  assert.equal(tree.base_tree, 'tree-before'); assert.equal(tree.tree.length, 2);
  assert.match(tree.tree[0].path, /^photos\/rome\/[a-f0-9]{64}\.jpg$/);
  assert.equal(tree.tree[1].path, 'data/photo-albums.json');
  assert.equal(mock.writes.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(mock.albums.albums[0].when, '2026-08'); assert.equal(JSON.stringify(places), before);
});

test('invalid month, city, duplicate and malformed image never create blobs', async () => {
  for (const change of [{ when: '2026-07' }, { cityId: '../private' }, { photos: [body.photos[0], body.photos[0]] }, { photos: [{ content: 'AAAA', caption: '' }] }]) {
    const mock = upstream();
    assert.equal((await handleRequest(request('/api/photos', { ...body, ...change }), env, mock.fetcher)).status, 400);
    assert.equal(mock.writes.length, 0);
  }
});

test('stale editors and a race at the final reference update preserve the winner', async () => {
  const stale = upstream({ stale: true });
  assert.equal((await handleRequest(request('/api/photos', body), env, stale.fetcher)).status, 409);
  assert.equal(stale.writes.length, 0);
  const race = upstream({ race: true });
  assert.equal((await handleRequest(request('/api/photos', body), env, race.fetcher)).status, 409);
  assert.equal(race.currentHead, head); assert.deepEqual(race.albums.albums, []);
});

test('retry after a lost successful response is idempotent', async () => {
  const mock = upstream({ loseResponse: true });
  assert.equal((await handleRequest(request('/api/photos', body), env, mock.fetcher)).status, 503);
  assert.equal(mock.albums.albums[0].photos.length, 1);
  const before = mock.writes.length;
  const response = await handleRequest(request('/api/photos', body), env, mock.fetcher);
  assert.equal(response.status, 200); assert.equal((await response.json()).alreadySaved, true);
  assert.equal(mock.writes.length, before); assert.equal(mock.albums.albums[0].photos.length, 1);
});

test('sign-out revokes the GitHub token instead of only hiding the UI', async () => {
  const mock = upstream();
  assert.equal((await handleRequest(request('/api/logout', {}), env, mock.fetcher)).status, 200);
  assert.equal(mock.writes.at(-1).path, '/applications/test-client/token');
  assert.equal(mock.writes.at(-1).method, 'DELETE');
});

test('every upload label and error has matching English and Chinese copy', () => {
  assert.deepEqual(Object.keys(uploadMessages.en).sort(), Object.keys(uploadMessages.zh).sort());
  for (const messages of Object.values(uploadMessages)) for (const message of Object.values(messages)) assert(['string', 'function'].includes(typeof message));
});
