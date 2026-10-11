// Confirmed repository writes can be shown before the static site is rebuilt.
// Keep their overlays until a published build proves it contains those commits.
const normalize = photo => typeof photo === 'string' ? { src: photo, caption: '' } : { src: photo.src, caption: photo.caption || '' };
const targetOf = (features, cityId, when) => {
  const city = features.find(feature => feature.id === cityId);
  return when ? city?.properties.visits.find(visit => visit.when === when) : city?.properties;
};
const entriesAt = (target, src) => (target?.photos || []).map(normalize).filter(photo => photo.src === src);

export function applyAlbumPatches(features, patches) {
  const result = structuredClone(features);
  for (const patch of patches) {
    const target = targetOf(result, patch.cityId, patch.when);
    if (!target) continue;
    const entries = (target.photos || []).map(normalize);
    const index = entries.findIndex(photo => photo.src === patch.src);
    target.photos = entries.filter(photo => photo.src !== patch.src);
    target.photos.splice(index < 0 ? target.photos.length : index, 0, ...structuredClone(patch.entries));
  }
  return result;
}

export function savedAlbumSnapshot(snapshot, change) {
  const next = structuredClone(snapshot);
  next.head = change.commit;
  next.albums.albums ??= [];
  let album = next.albums.albums.find(item => item.cityId === change.cityId && (item.when || '') === change.when);
  if (change.removed) {
    if (album) {
      album.photos = album.photos.filter(photo => photo.src !== change.removed.src);
      if (!album.photos.length) next.albums.albums = next.albums.albums.filter(item => item !== album);
    }
  } else {
    if (!album) { album = { cityId: change.cityId, when: change.when, photos: [] }; next.albums.albums.push(album); }
    for (const photo of change.photos) if (!album.photos.some(item => item.src === photo.src)) album.photos.push(photo);
  }
  return next;
}

function finalPatches(changes) {
  const patches = new Map();
  for (const change of changes) for (const patch of change.patches) patches.set(JSON.stringify([patch.cityId, patch.when, patch.src]), patch);
  return [...patches.values()];
}

function matches(features, patches) {
  return patches.every(patch => {
    const target = targetOf(features, patch.cityId, patch.when);
    return target && JSON.stringify(entriesAt(target, patch.src)) === JSON.stringify(patch.entries);
  });
}

export function createPhotoSync({
  getFeatures, onUpdate, onStatus = () => {}, loadPublished, checkPhoto,
  canCheck = () => true, now = Date.now, later = setTimeout, cancel = clearTimeout,
  releaseURL = url => URL.revokeObjectURL(url), maxWait = 10 * 60_000
}) {
  let pending = [], generation = 0, timer = null, checking = false, started = 0, attempts = 0, failures = 0, delayed = false, disposed = false;
  const previews = new Map(), cities = new Set();
  let adoptedCommits = new Set();
  const notify = () => onStatus();
  const schedule = delay => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (!disposed && pending.length && !checking) timer = later(() => { timer = null; void check(); }, delay);
  };
  function cleanPreviews() {
    const needed = new Set(finalPatches(pending).filter(patch => patch.entries.length).map(patch => patch.src));
    for (const [src, url] of previews) if (!needed.has(src)) { releaseURL(url); previews.delete(src); }
  }
  function record(change, localPreviews = []) {
    const target = targetOf(getFeatures(), change.cityId, change.when);
    const scope = { cityId: change.cityId, when: change.when };
    const patches = change.removed ? [{ ...scope, src: change.removed.src, entries: Array.from({ length: change.removed.remaining }, (_, index) => entriesAt(target, change.removed.src)[index] || { src: change.removed.src, caption: '' }) }] : change.photos.map(photo => {
      const existing = entriesAt(target, photo.src);
      // A previous check may adopt this write before its own API response arrives.
      // Keep canonical duplicates when adding a genuinely new album association.
      return { ...scope, src: photo.src, entries: (adoptedCommits.has(change.commit) || change.alreadySaved) && existing.length ? existing : [...existing, normalize(photo)] };
    });
    pending.push({ ...change, patches }); cities.add(change.cityId); generation++;
    for (const [src, url] of localPreviews) {
      if (previews.has(src)) releaseURL(previews.get(src));
      previews.set(src, url);
    }
    started = now(); attempts = 0; failures = 0; delayed = false;
    onUpdate(applyAlbumPatches(getFeatures(), patches));
    cleanPreviews(); notify(); schedule(1500);
  }
  async function check() {
    if (disposed || checking || !pending.length) return;
    if (now() - started >= maxWait) { delayed = true; notify(); return; }
    if (!canCheck()) { schedule(15_000); return; }
    if (timer !== null) cancel(timer);
    timer = null; checking = true; notify();
    const version = generation, batch = pending.slice();
    try {
      const data = await loadPublished();
      if (disposed || version !== generation) return;
      const commits = data.publication?.commits || [];
      const last = batch.findLastIndex(change => commits.includes(change.commit));
      if (last < 0) return;
      const confirmed = batch.slice(0, last + 1), patches = finalPatches(confirmed);
      // Identical old data is not proof: add then remove can return to the old view.
      if (!matches(data.features, patches)) return;
      const sources = [...new Set(patches.flatMap(patch => patch.entries.map(photo => photo.src)))];
      const available = await Promise.all(sources.map(src => checkPhoto(src, data.publication.commits[0])));
      if (disposed || version !== generation || !available.every(Boolean)) return;
      pending.splice(0, confirmed.length);
      adoptedCommits = new Set(commits);
      failures = 0; delayed = false;
      cleanPreviews();
      onUpdate(applyAlbumPatches(data.features, finalPatches(pending)));
    } catch {
      // A publishing or network failure must never undo a successful repository write.
      failures++; delayed = failures >= 2;
    } finally {
      checking = false;
      if (!disposed) {
        notify();
        if (pending.length) {
          if (now() - started >= maxWait) { delayed = true; notify(); }
          else schedule(version !== generation ? 1500 : [3000, 5000, 10_000, 15_000, 30_000][Math.min(attempts++, 4)]);
        }
      }
    }
  }
  function retry() {
    if (!pending.length || disposed) return;
    started = now(); attempts = 0; failures = 0; delayed = false; notify();
    if (!checking) void check();
  }
  return {
    record, check, retry,
    previewURL: src => previews.get(src),
    status(cityId) {
      if (!cities.has(cityId)) return null;
      return { phase: pending.some(change => change.cityId === cityId) ? delayed ? 'delayed' : 'pending' : 'published', checking };
    },
    dispose() { disposed = true; if (timer !== null) cancel(timer); for (const url of previews.values()) releaseURL(url); previews.clear(); }
  };
}
