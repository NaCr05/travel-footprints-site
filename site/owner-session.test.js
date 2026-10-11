import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerSession } from './owner-session.js';

test('shared login verifies popup, origin and nonce; expiry requires sign-in without making API calls', async () => {
  const originalWindow = globalThis.window, originalNow = Date.now;
  const popup = { closed: false }, listeners = new Map(); let destination, calls = 0;
  globalThis.window = { open(url) { destination = new URL(url); return popup; }, addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); } };
  try {
    const auth = createOwnerSession('https://service.example', { fetcher: async () => { calls++; return Response.json({ ok: true }); } });
    const signedIn = auth.signIn(); assert.equal(auth.signIn(), signedIn);
    const nonce = destination.searchParams.get('nonce'), now = originalNow();
    const message = { origin: 'https://service.example', source: popup, data: { type: 'footprints-auth', nonce, session: 'synthetic-test-session', login: 'test-owner', exp: now + 1000 } };
    const receive = listeners.get('message');
    receive({ ...message, origin: 'https://other.example' });
    receive({ ...message, source: {} });
    receive({ ...message, data: { ...message.data, nonce: 'wrong' } });
    assert.equal(auth.current(), null);
    receive(message); await signedIn; assert.equal(auth.current().login, 'test-owner'); assert.equal(listeners.size, 0);
    Date.now = () => now + 2000;
    assert.equal(auth.current(), null); await assert.rejects(auth.request('/api/wishlist'), /login_required/); assert.equal(calls, 0);
  } finally { Date.now = originalNow; globalThis.window = originalWindow; }
});
