import { uploadServiceURL } from './upload-config.js';

export function createOwnerSession(service, { fetcher = (...args) => fetch(...args) } = {}) {
  service = service.replace(/\/$/, '');
  let session = null, signingIn = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());
  const current = () => { if (session && session.exp <= Date.now()) session = null; return session; };
  async function request(path, options = {}) {
    if (!current()) throw new Error('login_required');
    if (!path.startsWith('/api/')) throw new Error('invalid_request');
    let response;
    try { response = await fetcher(`${service}${path}`, { ...options, headers: { Authorization: `Bearer ${session.value}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store', signal: AbortSignal.timeout(90_000) }); }
    catch { throw new Error('connection'); }
    const result = await response.json().catch(() => ({ error: 'service_unavailable' }));
    if (!response.ok) { if (response.status === 401) { session = null; notify(); } throw new Error(result.error || 'service_unavailable'); }
    return result;
  }
  function signIn() {
    if (signingIn) return signingIn;
    if (!service) return Promise.reject(new Error('not_configured'));
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    const popup = window.open(`${service}/auth/start?nonce=${nonce}`, 'footprints-owner-login', 'popup,width=560,height=700');
    if (!popup) return Promise.reject(new Error('popup_blocked'));
    signingIn = new Promise((resolve, reject) => {
      let finished = false;
      const finish = (failure, value) => { if (finished) return; finished = true; window.removeEventListener('message', receive); clearInterval(closed); clearTimeout(timeout); failure ? reject(failure) : resolve(value); };
      const receive = event => {
        if (event.origin !== new URL(service).origin || event.source !== popup || event.data?.type !== 'footprints-auth' || event.data?.nonce !== nonce) return;
        if (event.data.error) finish(new Error(event.data.error));
        else if (typeof event.data.session === 'string' && Number.isFinite(event.data.exp) && event.data.exp > Date.now()) finish(null, { value: event.data.session, login: event.data.login, exp: event.data.exp });
      };
      window.addEventListener('message', receive);
      const closed = setInterval(() => { if (popup.closed) finish(new Error('login_cancelled')); }, 1000);
      const timeout = setTimeout(() => finish(new Error('login_cancelled')), 5 * 60_000);
    }).then(value => { session = value; notify(); return value; }).finally(() => { signingIn = null; });
    return signingIn;
  }
  return { configured: !!service, current, request, signIn,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async signOut() { await request('/api/logout', { method: 'POST' }); session = null; notify(); }
  };
}
export const ownerSession = createOwnerSession(uploadServiceURL);
