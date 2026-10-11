import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.js';
import gateway from './pages-gateway/public/_worker.js';
import { seal } from './crypto.js';
const env = { SITE_ORIGIN: 'https://map.example', SERVICE_ORIGIN: 'https://uploads.example', REPOSITORY: 'example/map', REPOSITORY_ID: '2', OWNER_ID: '1', BRANCH: 'main', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', SESSION_SECRET: 'synthetic-testing-secret-only-never-deploy-12345678901234567890' };
const first = 'a'.repeat(40), next = 'b'.repeat(40), id = '1850147';
const city = { id, nameEn: 'Tokyo', nameZh: '东京', countryCode: 'JP', region: 'Tokyo', coordinates: [139.69, 35.68] };
const entry = { ...city, reason: 'Synthetic test', createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z' };
const token = await seal({ token: 'synthetic-test-token', id: 1, exp: Date.now() + 120_000 }, env.SESSION_SECRET, 'session');
const request = (method, data, session = token, origin = env.SITE_ORIGIN) => new Request(env.SERVICE_ORIGIN + '/api/wishlist', { method, headers: { Origin: origin, ...(session ? { Authorization: `Bearer ${session}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
function upstream({ owner = 1, push = true, repositoryId = 2, race = false, lose = false, initial = [], stale = false } = {}) {
  let head = stale ? next : first, doc = { schemaVersion: 1, cities: structuredClone(initial) }, tree;
  const calls = [], writes = [];
  const fetcher = async (url, opts = {}) => {
    const target = new URL(url), path = target.pathname, method = opts.method || 'GET', body = opts.body ? JSON.parse(opts.body) : null;
    assert.equal(target.origin, 'https://api.github.com'); calls.push(path); if (method !== 'GET') writes.push({ path, method, body });
    if (path === '/user') return Response.json({ id: owner, login: 'test-owner' });
    if (path === '/repos/example/map') return Response.json({ id: repositoryId, permissions: { push } });
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: head } });
    if (path.includes('/contents/')) {
      assert.equal(target.searchParams.get('ref'), head);
      assert(['/repos/example/map/contents/data/wishlist.json', `/repos/example/map/contents/data/cities/${Number(id) % 16}.json`].includes(path));
      return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(path.endsWith('/wishlist.json') ? doc : [city])).toString('base64') });
    }
    if (path.includes('/git/commits/') && method === 'GET') return Response.json({ tree: { sha: 'original-tree' } });
    if (path.endsWith('/git/trees')) { tree = body; return Response.json({ sha: 'next-tree' }); }
    if (path.endsWith('/git/commits')) { assert.deepEqual(body.parents, [head]); return Response.json({ sha: next }); }
    if (path.endsWith('/git/refs/heads/main')) {
      assert.equal(body.force, false);
      if (race) return Response.json({ message: 'simulated conflict' }, { status: 422 });
      doc = JSON.parse(tree.tree[0].content); head = next;
      if (lose) { lose = false; throw new Error('response lost after successful write'); }
      return Response.json({ object: { sha: next } });
    }
    throw new Error(`Unexpected path: ${path}`);
  };
  return { fetcher, calls, writes, get doc() { return doc; } };
}
test('wishlist rejects anonymous, cross-origin, nonowner, wrong repo and lost write access', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) for (const [session, origin, options, status] of [
    ['', env.SITE_ORIGIN, {}, 401], [token, 'https://other.example', {}, 403], [token, env.SITE_ORIGIN, { owner: 9 }, 403], [token, env.SITE_ORIGIN, { repositoryId: 9 }, 403], [token, env.SITE_ORIGIN, { push: false }, 403]
  ]) {
    const mock = upstream(options), response = await handleRequest(request(method, method === 'GET' ? null : { base: first, id, reason: '' }, session, origin), env, mock.fetcher);
    assert.equal(response.status, status); assert.equal(mock.writes.length, 0);
  }
});
test('add takes coordinates and labels only from the fixed catalog, writes only wishlist in one nonforce commit', async () => {
  const mock = upstream(), response = await handleRequest(request('POST', { base: first, id, reason: '  想去看看  ', coordinates: [0, 0], nameEn: 'tampered', path: 'private/file' }), env, mock.fetcher);
  assert.equal(response.status, 200); const result = await response.json();
  assert.deepEqual(result.wishlist.cities[0].coordinates, city.coordinates); assert.equal(result.wishlist.cities[0].nameEn, 'Tokyo'); assert.equal(result.wishlist.cities[0].reason, '想去看看');
  const tree = mock.writes.find(c => c.path.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree, 'original-tree'); assert.equal(tree.tree.length, 1); assert.equal(tree.tree[0].path, 'data/wishlist.json');
  assert.equal(mock.writes.filter(c => c.method === 'PATCH').length, 1);
});
test('empty reason is allowed; updates preserve place identity and creation date; removing preserves unrelated wishes', async () => {
  const mock = upstream({ initial: [entry] });
  assert.equal((await handleRequest(request('POST', { base: first, id, reason: '' }), env, mock.fetcher)).status, 200);
  assert.equal(mock.doc.cities[0].createdAt, entry.createdAt); assert.deepEqual(mock.doc.cities[0].coordinates, city.coordinates); assert.equal(mock.doc.cities[0].reason, '');
  const other = { ...entry, id: '2988507', nameEn: 'Paris' }, removal = upstream({ initial: [entry, other] });
  assert.equal((await handleRequest(request('DELETE', { base: first, id }), env, removal.fetcher)).status, 200);
  assert.deepEqual(removal.doc.cities, [other]);
});
test('invalid payload and stale base cannot create a Git object; a ref race fails without force', async () => {
  for (const delta of [{ base: 'bad' }, { id: '../photos' }, { id: '1850147/other' }, { reason: 'x'.repeat(501) }, { reason: {} }]) {
    const mock = upstream(); assert.equal((await handleRequest(request('POST', { base: first, id, reason: '', ...delta }), env, mock.fetcher)).status, 400); assert.equal(mock.writes.length, 0);
  }
  const stale = upstream({ stale: true }); assert.equal((await handleRequest(request('POST', { base: first, id, reason: '' }), env, stale.fetcher)).status, 409); assert.equal(stale.writes.length, 0);
  const race = upstream({ race: true }); assert.equal((await handleRequest(request('POST', { base: first, id, reason: '' }), env, race.fetcher)).status, 409); assert.deepEqual(race.doc.cities, []);
});
test('retry after lost response is idempotent for add and delete', async () => {
  for (const method of ['POST', 'DELETE']) {
    const mock = upstream({ lose: true, initial: method === 'DELETE' ? [entry] : [] }), data = { base: first, id, reason: '' };
    assert.equal((await handleRequest(request(method, data), env, mock.fetcher)).status, 503);
    const count = mock.writes.length, retry = await handleRequest(request(method, data), env, mock.fetcher);
    assert.equal(retry.status, 200); assert.equal((await retry.json()).unchanged, true); assert.equal(mock.writes.length, count);
  }
});
test('gateway forwards wishlist methods, body and auth unchanged to the existing service', async () => {
  for (const method of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
    const incoming = request(method, ['POST', 'DELETE'].includes(method) ? { base: first, id, reason: '' } : null);
    const result = await gateway.fetch(incoming, { PUBLIC_SERVICE_ORIGIN: env.SERVICE_ORIGIN, UPLOAD_SERVICE: { fetch(received) { assert.equal(received, incoming); return handleRequest(received, env, upstream().fetcher); } } });
    assert.equal(result.status, method === 'OPTIONS' ? 204 : 200);
  }
});
