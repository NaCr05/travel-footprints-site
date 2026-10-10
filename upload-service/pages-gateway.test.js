import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from './pages-gateway/public/_worker.js';
import { handleRequest } from './worker.js';

const serviceOrigin = 'https://uploads.example.pages.dev';
const mapOrigin = 'https://map.example';
const publicEnv = { PUBLIC_SERVICE_ORIGIN: serviceOrigin };

test('Pages previews, HTTP and missing configuration cannot invoke the backend', async () => {
  let calls = 0;
  const binding = { fetch() { calls++; throw new Error('Must not reach the backend'); } };
  for (const origin of ['https://preview.uploads.example.pages.dev', 'http://uploads.example.pages.dev', 'https://other.example']) {
    const response = await gateway.fetch(new Request(`${origin}/api/photos`, { method: 'POST' }), { ...publicEnv, UPLOAD_SERVICE: binding });
    assert.equal(response.status, 403);
  }
  assert.equal((await gateway.fetch(new Request(`${serviceOrigin}/health`), { UPLOAD_SERVICE: binding })).status, 503);
  assert.equal(calls, 0);
});

test('Only declared service paths reach the Worker; the home page uses static assets', async () => {
  let assetCalls = 0, backendCalls = 0;
  const env = { ...publicEnv,
    ASSETS: { fetch() { assetCalls++; return new Response('Public service information'); } },
    UPLOAD_SERVICE: { fetch() { backendCalls++; return Response.json({ ready: true }); } }
  };
  assert.equal(await (await gateway.fetch(new Request(serviceOrigin), env)).text(), 'Public service information');
  assert.equal((await gateway.fetch(new Request(`${serviceOrigin}/api/unknown`), env)).status, 404);
  assert.equal((await gateway.fetch(new Request(`${serviceOrigin}/anything`), env)).status, 404);
  assert.equal(assetCalls, 1);
  assert.equal(backendCalls, 0);
});

test('The binding preserves uploads, authentication headers and callback response headers', async () => {
  const request = new Request(`${serviceOrigin}/api/photos`, {
    method: 'POST', headers: { Origin: mapOrigin, Authorization: 'Bearer synthetic-session', Cookie: 'synthetic=cookie', 'Content-Type': 'application/json' },
    body: JSON.stringify({ cityId: 'rome', photos: [] })
  });
  const upstream = new Response(null, { status: 302, headers: {
    Location: `${serviceOrigin}/auth/callback`, 'Set-Cookie': '__Host-test=synthetic; Secure; HttpOnly; Path=/',
    'Access-Control-Allow-Origin': mapOrigin, 'Cache-Control': 'no-store'
  } });
  const result = await gateway.fetch(request, { ...publicEnv, UPLOAD_SERVICE: { async fetch(received) {
    assert.equal(received, request);
    assert.equal(received.url, request.url);
    assert.equal(received.headers.get('Authorization'), 'Bearer synthetic-session');
    assert.equal(received.headers.get('Origin'), mapOrigin);
    assert.equal(received.headers.get('Cookie'), 'synthetic=cookie');
    assert.deepEqual(await received.json(), { cityId: 'rome', photos: [] });
    return upstream;
  } } });
  assert.equal(result, upstream);
  assert.equal(result.headers.get('Set-Cookie'), '__Host-test=synthetic; Secure; HttpOnly; Path=/');
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), mapOrigin);
});

test('The real Worker still enforces sign-in and CORS and builds the new callback URL', async () => {
  const workerEnv = {
    SITE_ORIGIN: mapOrigin, SERVICE_ORIGIN: serviceOrigin,
    GITHUB_CLIENT_ID: 'synthetic-client', GITHUB_CLIENT_SECRET: 'synthetic-secret',
    SESSION_SECRET: 'synthetic-test-only-session-secret-never-deploy-123456789',
    REPOSITORY: 'example/map', REPOSITORY_ID: '2', OWNER_ID: '1', BRANCH: 'main'
  };
  const env = { ...publicEnv, UPLOAD_SERVICE: { fetch(request) {
    return handleRequest(request, workerEnv, () => { throw new Error('Unexpected external request'); });
  } } };
  const signedOut = await gateway.fetch(new Request(`${serviceOrigin}/api/snapshot`, { headers: { Origin: mapOrigin } }), env);
  assert.equal(signedOut.status, 401);
  assert.equal((await signedOut.json()).error, 'login_required');
  const wrongOrigin = await gateway.fetch(new Request(`${serviceOrigin}/api/snapshot`, { headers: { Origin: 'https://other.example' } }), env);
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get('Access-Control-Allow-Origin'), null);
  const preflight = await gateway.fetch(new Request(`${serviceOrigin}/api/photos`, { method: 'OPTIONS', headers: { Origin: mapOrigin } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), mapOrigin);
  const login = await gateway.fetch(new Request(`${serviceOrigin}/auth/start?nonce=${'a'.repeat(43)}`), env);
  assert.equal(login.status, 302);
  const destination = new URL(login.headers.get('Location'));
  assert.equal(destination.origin, 'https://github.com');
  assert.equal(destination.searchParams.get('redirect_uri'), `${serviceOrigin}/auth/callback`);
  assert.equal(destination.searchParams.get('code_challenge_method'), 'S256');
  assert.match(login.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('An absent or failed binding fails closed without exposing backend errors', async () => {
  const request = new Request(`${serviceOrigin}/health`);
  assert.equal((await gateway.fetch(request, publicEnv)).status, 503);
  const response = await gateway.fetch(request, { ...publicEnv, UPLOAD_SERVICE: { fetch() { throw new Error('private upstream details'); } } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'service_unavailable' });
});

test('The deployed gateway route forwards DELETE without changing its scoped body', async () => {
  const payload = { base: 'a'.repeat(40), cityId: 'rome', when: '2026-08', src: './photos/test.jpg' };
  const request = new Request(`${serviceOrigin}/api/photos`, { method: 'DELETE', headers: { Origin: mapOrigin, Authorization: 'Bearer synthetic-session', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await gateway.fetch(request, { ...publicEnv, UPLOAD_SERVICE: { async fetch(received) {
    assert.equal(received.method, 'DELETE'); assert.equal(received.headers.get('Origin'), mapOrigin);
    assert.equal(received.headers.get('Authorization'), 'Bearer synthetic-session');
    assert.deepEqual(await received.json(), payload);
    return Response.json({ removed: true });
  } } });
  assert.equal(result.status, 200);
});
