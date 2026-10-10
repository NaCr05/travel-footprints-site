import { albumLimits, uploadLimits, mergePhotoAlbums, photoPath } from '../site/album-model.js';
import { base64, unbase64, sha256 } from './crypto.js';
import { cleanJPEG } from './images.js';
export class UploadError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const decoder = new TextDecoder();
export function githubClient(token, fetcher = fetch) {
  return async (path, options = {}) => {
    const response = await fetcher(`https://api.github.com${path}`, {
      method: options.method || 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'travel-footprints-upload', 'Content-Type': 'application/json' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(25_000)
    });
    if (!response.ok) {
      if (response.status === 401) throw new UploadError('login_required', 401);
      if (response.status === 409 || response.status === 422) throw new UploadError('conflict', 409);
      if (response.status === 403 || response.status === 429) throw new UploadError('permission_or_rate_limit', 403);
      throw new UploadError('github_unavailable', 502);
    }
    return response.status === 204 ? null : response.json();
  };
}
export async function verifyOwner(api, env) {
  const user = await api('/user');
  if (String(user.id) !== String(env.OWNER_ID)) throw new UploadError('owner_only', 403);
  const repo = await api(`/repos/${env.REPOSITORY}`);
  if (String(repo.id) !== String(env.REPOSITORY_ID) || !repo.permissions?.push) throw new UploadError('repo_permission', 403);
  return { login: user.login, id: user.id };
}
export async function readSnapshot(api, env) {
  const prefix = `/repos/${env.REPOSITORY}`;
  const ref = await api(`${prefix}/git/ref/heads/${encodeURIComponent(env.BRANCH)}`);
  const head = ref.object.sha;
  const read = async name => {
    const file = await api(`${prefix}/contents/${name}?ref=${head}`);
    if (file.encoding !== 'base64' || file.type !== 'file') throw new UploadError('invalid_repository', 409);
    try { return JSON.parse(decoder.decode(unbase64(file.content.replace(/\s/g, '')))); }
    catch { throw new UploadError('invalid_repository', 409); }
  };
  const [places, albums, commit] = await Promise.all([read('data/places.geojson'), read('data/photo-albums.json'), api(`${prefix}/git/commits/${head}`)]);
  try { mergePhotoAlbums(places, albums); } catch { throw new UploadError('invalid_repository', 409); }
  return { head, tree: commit.tree.sha, places, albums };
}
export async function appendPhotos(api, env, input) {
  if (!input || !/^[a-f0-9]{40}$/.test(input.base || '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.cityId || '') || !Array.isArray(input.photos) || input.photos.length < 1 || input.photos.length > uploadLimits.batch) throw new UploadError('invalid_request');
  const when = input.when ?? '';
  if (typeof when !== 'string' || (when && !/^\d{4}-(0[1-9]|1[0-2])$/.test(when))) throw new UploadError('invalid_month');
  const photos = await Promise.all(input.photos.map(async photo => {
    if (typeof photo.caption !== 'string' || photo.caption.length > albumLimits.caption) throw new UploadError('invalid_caption');
    let bytes; try { bytes = cleanJPEG(photo.content); } catch { throw new UploadError('invalid_image'); }
    const hash = await sha256(bytes);
    return { src: `./photos/${input.cityId}/${hash}.jpg`, caption: photo.caption, bytes };
  }));
  if (new Set(photos.map(photo => photo.src)).size !== photos.length) throw new UploadError('duplicate_photo');
  const current = await readSnapshot(api, env);
  const doc = structuredClone(current.albums); doc.albums ??= [];
  const feature = current.places.features.find(city => city.id === input.cityId);
  if (!feature) throw new UploadError('invalid_city');
  if (when && !feature.properties.visits.some(visit => visit.when === when)) throw new UploadError('invalid_month');
  let album = doc.albums.find(item => item.cityId === input.cityId && (item.when || '') === when);
  const entries = photos.map(({ src, caption }) => ({ src, caption }));
  // A retry after a lost response must not insert the same images twice.
  if (entries.every(entry => album?.photos?.some(photo => photo.src === entry.src && (photo.caption || '') === entry.caption))) return { commit: current.head, photos: entries, alreadySaved: true };
  if (current.head !== input.base) throw new UploadError('conflict', 409);
  if (entries.some(entry => album?.photos?.some(photo => photo.src === entry.src))) throw new UploadError('duplicate_photo');
  if (!album) { album = { cityId: input.cityId, when, photos: [] }; doc.albums.push(album); }
  album.photos ??= [];
  if (album.photos.length + entries.length > albumLimits.photos) throw new UploadError('album_full');
  album.photos.push(...entries);
  try { mergePhotoAlbums(current.places, doc); } catch { throw new UploadError('invalid_album'); }
  const prefix = `/repos/${env.REPOSITORY}`;
  const files = [];
  for (const photo of photos) {
    const blob = await api(`${prefix}/git/blobs`, { method: 'POST', body: { encoding: 'base64', content: base64(photo.bytes) } });
    files.push({ path: photo.src.slice(2), mode: '100644', type: 'blob', sha: blob.sha });
  }
  files.push({ path: 'data/photo-albums.json', mode: '100644', type: 'blob', content: JSON.stringify(doc, null, 2) + '\n' });
  const tree = await api(`${prefix}/git/trees`, { method: 'POST', body: { base_tree: current.tree, tree: files } });
  const commit = await api(`${prefix}/git/commits`, { method: 'POST', body: { message: `Add ${entries.length} travel photo(s) to ${input.cityId}${when ? ` (${when})` : ''}`, tree: tree.sha, parents: [current.head] } });
  // Non-forced update preserves any concurrent edit; images and index go live together.
  await api(`${prefix}/git/refs/heads/${encodeURIComponent(env.BRANCH)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  return { commit: commit.sha, photos: entries, alreadySaved: false };
}

export async function removePhoto(api, env, input) {
  if (!input || !/^[a-f0-9]{40}$/.test(input.base || '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.cityId || '')) throw new UploadError('invalid_request');
  const when = input.when ?? '';
  if (typeof when !== 'string' || (when && !/^\d{4}-(0[1-9]|1[0-2])$/.test(when))) throw new UploadError('invalid_month');
  let path; try { path = photoPath(input.src); } catch { throw new UploadError('invalid_photo'); }
  const current = await readSnapshot(api, env);
  const feature = current.places.features.find(city => city.id === input.cityId);
  if (!feature) throw new UploadError('invalid_city');
  const target = when ? feature.properties.visits.find(visit => visit.when === when) : feature.properties;
  if (!target) throw new UploadError('invalid_month');
  const doc = structuredClone(current.albums);
  const album = doc.albums?.find(item => item.cityId === input.cityId && (item.when || '') === when);
  // Canonical city photos can also refer to this file. Removing an album entry
  // must neither rewrite those records nor erase a file they still use.
  const source = photo => typeof photo === 'string' ? photo : photo.src;
  const remaining = (target.photos || []).filter(photo => source(photo) === input.src).length;
  if (!album?.photos?.some(photo => photo.src === input.src)) {
    // A missing association is a no-op, even after a lost successful response.
    // It can never be used to delete an arbitrary (or another album's) file.
    return { commit: current.head, removed: { src: input.src, remaining }, alreadyRemoved: true, fileRemoved: false };
  }
  if (current.head !== input.base) throw new UploadError('conflict', 409);
  album.photos = album.photos.filter(photo => photo.src !== input.src);
  if (!album.photos.length) doc.albums = doc.albums.filter(item => item !== album);
  try { mergePhotoAlbums(current.places, doc); } catch { throw new UploadError('invalid_album'); }
  const baseURL = `${env.SITE_ORIGIN}/${env.REPOSITORY.split('/')[1]}/`;
  const fileURL = new URL(input.src, baseURL);
  const referencesFile = photo => {
    try {
      const url = new URL(source(photo), baseURL);
      return url.origin === fileURL.origin && decodeURIComponent(url.pathname) === fileURL.pathname;
    } catch { return false; }
  };
  const referenced = doc.albums.some(item => item.photos?.some(referencesFile)) || current.places.features.some(city =>
    (city.properties.photos || []).some(referencesFile) || city.properties.visits.some(visit => (visit.photos || []).some(referencesFile)));
  const files = [];
  files.push({ path: 'data/photo-albums.json', mode: '100644', type: 'blob', content: JSON.stringify(doc, null, 2) + '\n' });
  if (!referenced) files.push({ path, mode: '100644', type: 'blob', sha: null });
  const prefix = `/repos/${env.REPOSITORY}`;
  const tree = await api(`${prefix}/git/trees`, { method: 'POST', body: { base_tree: current.tree, tree: files } });
  const commit = await api(`${prefix}/git/commits`, { method: 'POST', body: { message: `Remove a travel photo from ${input.cityId}${when ? ` (${when})` : ''}`, tree: tree.sha, parents: [current.head] } });
  await api(`${prefix}/git/refs/heads/${encodeURIComponent(env.BRANCH)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  return { commit: commit.sha, removed: { src: input.src, remaining }, alreadyRemoved: false, fileRemoved: !referenced };
}
