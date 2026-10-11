import { seal, unseal, randomToken, digest, base64url } from './crypto.js';
import { githubClient, verifyOwner, readSnapshot, appendPhotos, removePhoto, UploadError } from './github.js';
import { readWishlist, writeWishlist } from './wishlist.js';

const encoder = new TextEncoder();
const stateCookie = '__Host-footprints-login';
const cookie = (value, age) => `${stateCookie}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const ready = env => env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET?.length >= 43 &&
  /^https:\/\/[^/]+$/.test(env.SITE_ORIGIN || '') && /^https:\/\/[^/]+$/.test(env.SERVICE_ORIGIN || '') &&
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.REPOSITORY || '') && /^\d+$/.test(env.OWNER_ID || '') && /^\d+$/.test(env.REPOSITORY_ID || '') && env.BRANCH;
const json = (body, status = 200) => Response.json(body, { status, headers });
function cors(response, origin, env) {
  const result = new Response(response.body, response);
  if (origin === env.SITE_ORIGIN) {
    result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    result.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    result.headers.set('Vary', 'Origin');
  }
  return result;
}
function popup(env, payload) {
  const nonce = randomToken();
  const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const message = payload.error ? 'Sign-in could not be completed. Close this window and try again from the map.' : 'Signed in. You can return to the map.';
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Travel Footprints · Sign in</title><style nonce="${nonce}">body{background:#1d1e20;color:#dcdfe1;font:16px/1.6 system-ui;padding:40px;max-width:40rem;margin:auto}h1{font-weight:400;font-size:24px}</style><h1>Travel Footprints</h1><p>${message}</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${safeJSON({ type: 'footprints-auth', ...payload })},${safeJSON(env.SITE_ORIGIN)});window.close();}</script></html>`;
  return new Response(html, { status: 200, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie('', 0), 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` } });
}
async function beginLogin(url, env) {
  const nonce = url.searchParams.get('nonce');
  if (!/^[a-zA-Z0-9_-]{32,64}$/.test(nonce || '')) throw new UploadError('invalid_request');
  const state = randomToken(), verifier = randomToken();
  const stored = await seal({ nonce, state, verifier, exp: Date.now() + 10 * 60_000 }, env.SESSION_SECRET, 'login');
  const destination = new URL('https://github.com/login/oauth/authorize');
  destination.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${env.SERVICE_ORIGIN}/auth/callback`, state, code_challenge: base64url(await digest(encoder.encode(verifier))), code_challenge_method: 'S256', allow_signup: 'false' }).toString();
  return new Response(null, { status: 302, headers: { ...headers, Location: destination.href, 'Set-Cookie': cookie(stored, 600) } });
}
async function finishLogin(request, url, env, fetcher) {
  let login;
  try {
    const value = request.headers.get('Cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${stateCookie}=`))?.slice(stateCookie.length + 1);
    login = await unseal(value, env.SESSION_SECRET, 'login');
    if (url.searchParams.get('state') !== login.state || !url.searchParams.get('code') || url.searchParams.has('error')) throw new UploadError('login_failed');
    const response = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), code_verifier: login.verifier, redirect_uri: `${env.SERVICE_ORIGIN}/auth/callback`, repository_id: env.REPOSITORY_ID }),
      signal: AbortSignal.timeout(20_000)
    });
    const granted = await response.json();
    if (!response.ok || !granted.access_token || granted.error) throw new UploadError('login_failed');
    const user = await verifyOwner(githubClient(granted.access_token, fetcher), env);
    const exp = Date.now() + Math.min(granted.expires_in || 3600, 3600) * 1000;
    const session = await seal({ token: granted.access_token, id: user.id, exp }, env.SESSION_SECRET, 'session');
    // Refresh tokens are deliberately not retained. The browser receives only an
    // encrypted, one-hour service session, never the GitHub token/client secret.
    return popup(env, { nonce: login.nonce, session, login: user.login, exp });
  } catch (error) { return popup(env, { nonce: login?.nonce, error: error instanceof UploadError ? error.code : 'login_failed' }); }
}
async function readJSON(request) {
  const limit = 15 * 1024 * 1024;
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new UploadError('invalid_request', 415);
  if (Number(request.headers.get('Content-Length')) > limit) throw new UploadError('too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError('invalid_request');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new UploadError('too_large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new UploadError('invalid_request'); }
}

export async function handleRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url), origin = request.headers.get('Origin');
  try {
    if (url.pathname === '/health' && request.method === 'GET') return cors(json({ ready: !!ready(env) }), origin, env);
    if (!ready(env)) throw new UploadError('not_configured', 503);
    if (url.origin !== env.SERVICE_ORIGIN) throw new UploadError('invalid_origin', 403);
    if (url.pathname === '/auth/start' && request.method === 'GET') return await beginLogin(url, env);
    if (url.pathname === '/auth/callback' && request.method === 'GET') return await finishLogin(request, url, env, fetcher);
    if (!url.pathname.startsWith('/api/')) throw new UploadError('not_found', 404);
    if (origin !== env.SITE_ORIGIN) throw new UploadError('invalid_origin', 403);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204, headers }), origin, env);
    let session;
    try { session = await unseal(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env.SESSION_SECRET, 'session'); }
    catch { throw new UploadError('login_required', 401); }
    if (String(session.id) !== String(env.OWNER_ID)) throw new UploadError('owner_only', 403);
    const api = githubClient(session.token, fetcher);
    const user = await verifyOwner(api, env);
    let result;
    if (url.pathname === '/api/snapshot' && request.method === 'GET') {
      const snapshot = await readSnapshot(api, env);
      result = { head: snapshot.head, albums: snapshot.albums, login: user.login, canRemove: true };
    } else if (url.pathname === '/api/wishlist' && request.method === 'GET') {
      result = await readWishlist(api, env);
    } else if (url.pathname === '/api/wishlist' && ['POST', 'DELETE'].includes(request.method)) {
      result = await writeWishlist(api, env, await readJSON(request), request.method === 'DELETE');
    } else if (url.pathname === '/api/photos' && request.method === 'POST') {
      result = await appendPhotos(api, env, await readJSON(request));
    } else if (url.pathname === '/api/photos' && request.method === 'DELETE') {
      result = await removePhoto(api, env, await readJSON(request));
    } else if (url.pathname === '/api/logout' && request.method === 'POST') {
      const response = await fetcher(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, { method: 'DELETE', headers: { Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'travel-footprints-upload' }, body: JSON.stringify({ access_token: session.token }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new UploadError('github_unavailable', 502);
      result = { loggedOut: true };
    } else throw new UploadError('not_found', 404);
    return cors(json(result), origin, env);
  } catch (error) {
    const known = error instanceof UploadError;
    return cors(json({ error: known ? error.code : 'service_unavailable' }, known ? error.status : 503), origin, env);
  }
}
export default { fetch: (request, env) => handleRequest(request, env) };
