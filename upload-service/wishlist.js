import { UploadError } from './github.js';
import { unbase64 } from './crypto.js';
import { validateWishlist, wishLimits } from '../site/wishlist-model.js';

async function readDocument(api, prefix, file, head) {
  const response = await api(`${prefix}/contents/${file}?ref=${head}`);
  if (response.type !== 'file' || response.encoding !== 'base64') throw new UploadError('invalid_repository', 409);
  try { return JSON.parse(new TextDecoder().decode(unbase64(response.content.replace(/\s/g, '')))); }
  catch { throw new UploadError('invalid_repository', 409); }
}
export async function readWishlist(api, env) {
  const prefix = `/repos/${env.REPOSITORY}`;
  const head = (await api(`${prefix}/git/ref/heads/${encodeURIComponent(env.BRANCH)}`)).object.sha;
  const doc = await readDocument(api, prefix, 'data/wishlist.json', head);
  try { validateWishlist(doc); } catch { throw new UploadError('invalid_repository', 409); }
  return { head, wishlist: doc };
}
export async function writeWishlist(api, env, input, remove = false) {
  if (!input || !/^[a-f0-9]{40}$/.test(input.base || '') || !/^[1-9]\d{0,9}$/.test(input.id || '')) throw new UploadError('invalid_request');
  if (!remove && (typeof input.reason !== 'string' || input.reason.length > wishLimits.reason)) throw new UploadError('invalid_reason');
  const current = await readWishlist(api, env), doc = structuredClone(current.wishlist);
  const prior = doc.cities.find(c => c.id === input.id), reason = input.reason?.trim();
  if (remove && !prior || !remove && prior && prior.reason === reason) return { commit: current.head, wishlist: doc, unchanged: true };
  if (input.base !== current.head) throw new UploadError('conflict', 409);
  const prefix = `/repos/${env.REPOSITORY}`;
  if (remove) doc.cities = doc.cities.filter(c => c.id !== input.id);
  else if (prior) { prior.reason = reason; prior.updatedAt = new Date().toISOString(); }
  else {
    if (doc.cities.length >= wishLimits.count) throw new UploadError('wishlist_full');
    // The client sends only an ID. Labels/coordinates come from a fixed, reviewed
    // catalog path at the same revision, never an arbitrary URL or client payload.
    const bucket = Number(input.id) % 16;
    const catalog = await readDocument(api, prefix, `data/cities/${bucket}.json`, current.head);
    const city = Array.isArray(catalog) && catalog.find(c => c.id === input.id);
    if (!city) throw new UploadError('invalid_city');
    const now = new Date().toISOString();
    const { id, nameEn, nameZh, countryCode, region, coordinates, visitedId } = city;
    doc.cities.push({ id, nameEn, nameZh, countryCode, region, coordinates, ...(visitedId ? { visitedId } : {}), reason, createdAt: now, updatedAt: now });
  }
  try { validateWishlist(doc); } catch { throw new UploadError('invalid_wishlist'); }
  const parent = await api(`${prefix}/git/commits/${current.head}`);
  const tree = await api(`${prefix}/git/trees`, { method: 'POST', body: { base_tree: parent.tree.sha, tree: [{ path: 'data/wishlist.json', mode: '100644', type: 'blob', content: JSON.stringify(doc, null, 2) + '\n' }] } });
  const commit = await api(`${prefix}/git/commits`, { method: 'POST', body: { message: `${remove ? 'Remove' : prior ? 'Update' : 'Add'} wishlist city ${input.id}`, tree: tree.sha, parents: [current.head] } });
  await api(`${prefix}/git/refs/heads/${encodeURIComponent(env.BRANCH)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  return { commit: commit.sha, wishlist: doc, unchanged: false };
}
