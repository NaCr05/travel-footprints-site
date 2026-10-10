const encoder = new TextEncoder(), decoder = new TextDecoder();
export function base64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export const unbase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
export const base64url = bytes => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unbase64url = value => unbase64(value.replace(/-/g, '+').replace(/_/g, '/'));
export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
export const sha256 = async bytes => [...await digest(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function key(secret) {
  if (typeof secret !== 'string' || secret.length < 43) throw new Error('Session secret is not configured.');
  return crypto.subtle.importKey('raw', await digest(encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value, secret, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`footprints-v1:${purpose}`) }, await key(secret), encoder.encode(JSON.stringify(value))));
  return `${base64url(iv)}.${base64url(encrypted)}`;
}
export async function unseal(value, secret, purpose, now = Date.now()) {
  const parts = String(value).split('.');
  if (parts.length !== 2 || value.length > 8192) throw new Error('Invalid session.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(parts[0]), additionalData: encoder.encode(`footprints-v1:${purpose}`) }, await key(secret), unbase64url(parts[1]));
  const data = JSON.parse(decoder.decode(plain));
  if (!Number.isFinite(data.exp) || data.exp <= now) throw new Error('Session expired.');
  return data;
}
