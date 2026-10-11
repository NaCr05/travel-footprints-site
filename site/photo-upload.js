import { albumLimits, uploadLimits } from './album-model.js';
import { createPhotoSync, savedAlbumSnapshot } from './photo-sync.js';
import { uploadServiceURL } from './upload-config.js';
import { ownerSession } from './owner-session.js';

const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text != null) element.textContent = text; return element; };
const b64 = async blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });

export async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('unsupported_photo');
  if (!file.size || file.size > uploadLimits.inputBytes) throw new Error('input_too_large');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('invalid_image'); });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > uploadLimits.pixels) throw new Error('input_too_large');
    const scale = Math.min(1, uploadLimits.side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob;
    for (const quality of [.86, .74, .6]) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= uploadLimits.bytes) break;
    }
    if (!blob || blob.type !== 'image/jpeg' || blob.size > uploadLimits.bytes) throw new Error('input_too_large');
    return { name: file.name, blob, url: URL.createObjectURL(blob), content: await b64(blob), caption: '' };
  } finally { bitmap.close(); }
}

export function createPhotoUploader({ getUI, getFeatures, onUpdate }) {
  const dialog = node('dialog', 'upload-dialog'); dialog.setAttribute('aria-labelledby', 'upload-title');
  document.body.append(dialog);
  const service = uploadServiceURL.replace(/\/$/, '');
  let session = null, feature = null, photos = [], when = '', snapshot = null, busy = false, status = '', error = '', refreshRequired = false, opener, snapshotAt = 0;
  let mode = 'add', pendingRemoval = null;
  const ui = () => getUI(), t = (key, params) => ui().t(key, params);
  const errorText = code => { try { return t(`uploadError_${code}`); } catch { return t('uploadError_service_unavailable'); } };
  const button = (text, action, primary = false) => { const item = node('button', `upload-button${primary ? ' primary' : ''}`, text); item.type = 'button'; item.dataset.focusKey = action.name || text; item.addEventListener('click', action); return item; };
  const sync = createPhotoSync({
    getFeatures, onUpdate, onStatus: updateSyncStatus,
    canCheck: () => !document.hidden && navigator.onLine !== false,
    async loadPublished() {
      const url = new URL('./data/places.geojson', document.baseURI); url.searchParams.set('check', Date.now());
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('connection');
      return response.json();
    },
    async checkPhoto(src, revision) {
      const url = new URL(src, document.baseURI); url.searchParams.set('published', revision);
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      return response.ok;
    }
  });
  function fillSyncStatus(element) {
    const state = sync.status(element.dataset.syncCity);
    element.hidden = !state;
    if (!state) return;
    const text = t({ pending: 'uploadSyncPending', delayed: 'uploadSyncDelayed', published: 'uploadSyncPublished' }[state.phase]);
    if (element.firstElementChild.textContent !== text) element.firstElementChild.textContent = text;
    const retry = element.lastElementChild;
    retry.textContent = t('uploadSyncRetry'); retry.hidden = state.phase !== 'delayed'; retry.disabled = state.checking;
  }
  function updateSyncStatus() {
    document.querySelectorAll('[data-sync-city]').forEach(fillSyncStatus);
    dialog.querySelectorAll('[data-saved-photo]').forEach(image => {
      const src = sync.previewURL(image.dataset.savedPhoto) || image.dataset.savedPhoto;
      if (image.getAttribute('src') !== src) image.src = src;
    });
  }
  function syncStatusElement(cityId) {
    const element = node('div', 'album-sync'); element.dataset.syncCity = cityId;
    const message = node('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    element.append(message, button(t('uploadSyncRetry'), () => sync.retry())); fillSyncStatus(element);
    return element;
  }
  window.addEventListener('online', () => sync.retry());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.retry(); });
  function cleanDraft() { photos.forEach(photo => URL.revokeObjectURL(photo.url)); photos = []; pendingRemoval = null; status = ''; error = ''; }
  function close() { if (!busy) { pendingRemoval = null; dialog.close(); } }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => (opener?.isConnected ? opener : document.querySelector('.album-add'))?.focus({ preventScroll: true }));
  window.addEventListener('beforeunload', event => { if (photos.length || busy) { event.preventDefault(); event.returnValue = ''; } });

  async function api(path, options = {}) {
    return ownerSession.request(path, options);
  }
  async function refresh() {
    busy = true; error = ''; pendingRemoval = null; status = 'uploadReading'; render();
    try { snapshot = await api('/api/snapshot'); snapshotAt = Date.now(); refreshRequired = false; status = 'uploadReady'; }
    catch (failure) { error = failure.message; status = ''; }
    finally { busy = false; render(); }
  }
  async function login() {
    busy = true; error = ''; status = 'uploadSigningIn'; render();
    try {
      session = await ownerSession.signIn();
      snapshot = await api('/api/snapshot'); snapshotAt = Date.now(); refreshRequired = false; status = 'uploadReady';
    } catch (failure) { error = failure.message; status = ''; }
    finally { busy = false; render(); }
  }
  async function logout() {
    busy = true; error = ''; render();
    try { await ownerSession.signOut(); session = null; snapshot = null; status = ''; }
    catch (failure) { error = failure.message; }
    finally { busy = false; render(); }
  }
  async function choose(files) {
    if (busy) return;
    const list = Array.from(files);
    if (!list.length) return;
    if (photos.length + list.length > uploadLimits.batch) { error = 'batch_full'; render(); return; }
    busy = true; status = 'uploadPreparing'; error = ''; render();
    for (const file of list) {
      try {
        const prepared = await preparePhoto(file);
        if (photos.some(photo => photo.content === prepared.content)) { URL.revokeObjectURL(prepared.url); throw new Error('duplicate_photo'); }
        photos.push(prepared);
      } catch (failure) { error = failure.message; }
    }
    busy = false; status = ''; render();
  }
  async function save() {
    if (busy || !photos.length || !snapshot || !session || refreshRequired) return;
    busy = true; error = ''; status = 'uploadSaving'; render();
    try {
      const result = await api('/api/photos', { method: 'POST', body: JSON.stringify({ base: snapshot.head, cityId: feature.id, when, photos: photos.map(({ content, caption }) => ({ content, caption })) }) });
      const change = { ...result, cityId: feature.id, when };
      snapshot = savedAlbumSnapshot(snapshot, change); snapshotAt = Date.now();
      // Separate URLs let the album keep its preview after the upload draft closes.
      const previews = result.photos.map((photo, index) => [photo.src, URL.createObjectURL(photos[index].blob)]);
      sync.record(change, previews);
      cleanDraft(); mode = 'manage';
    } catch (failure) { error = failure.message; status = ''; refreshRequired = failure.message === 'conflict'; }
    finally { busy = false; render(); }
  }
  function switchMode(next) {
    if (busy || next === mode) return;
    if (photos.length && !window.confirm(t('uploadSwitchDiscard'))) return;
    cleanDraft(); mode = next; render();
    if (session && (!snapshot || refreshRequired)) refresh();
  }
  function cancelRemoval() {
    const key = pendingRemoval?.key;
    pendingRemoval = null; error = ''; status = ''; render();
    [...dialog.querySelectorAll('[data-focus-key]')].find(control => control.dataset.focusKey === key)?.focus();
  }
  async function confirmRemoval() {
    if (busy || !pendingRemoval || !session || !snapshot?.canRemove || refreshRequired) return;
    busy = true; error = ''; status = 'uploadRemoving'; render();
    try {
      const result = await api('/api/photos', { method: 'DELETE', body: JSON.stringify({ base: snapshot.head, cityId: feature.id, when: pendingRemoval.when, src: pendingRemoval.src }) });
      const change = { ...result, cityId: feature.id, when: pendingRemoval.when };
      snapshot = savedAlbumSnapshot(snapshot, change); snapshotAt = Date.now();
      sync.record(change); pendingRemoval = null; status = '';
    } catch (failure) { error = failure.message; status = ''; refreshRequired = failure.message === 'conflict'; }
    finally { busy = false; render(); }
  }
  function render() {
    session = ownerSession.current();
    const active = dialog.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const scroll = dialog.scrollTop;
    dialog.replaceChildren();
    const header = node('div', 'upload-heading');
    const title = node('h2', '', t('uploadTitle', { city: ui().city(feature.properties) })); title.id = 'upload-title'; title.tabIndex = -1; title.dataset.focusKey = 'title';
    const dismiss = button(t('uploadClose'), close); dismiss.disabled = busy; header.append(title, dismiss); dialog.append(header);
    const intro = node('p', 'upload-copy', service ? t(mode === 'manage' ? 'uploadManageIntro' : 'uploadIntro') : t('uploadPreviewOnly')); dialog.append(intro);
    const account = node('div', 'upload-account');
    account.append(node('span', '', session ? t('uploadSignedIn', { login: session.login }) : t('uploadOwnerOnly')));
    const auth = button(t(session ? 'uploadSignOut' : 'uploadSignIn'), session ? logout : login); auth.disabled = !service || busy; account.append(auth); dialog.append(account);
    const modes = node('div', 'upload-modes'); modes.setAttribute('aria-label', t('uploadManage'));
    for (const value of ['add', 'manage']) {
      const control = button(t(value === 'add' ? 'uploadAdd' : 'uploadManage'), () => switchMode(value));
      control.dataset.focusKey = `mode-${value}`; control.setAttribute('aria-pressed', String(mode === value)); control.disabled = busy || !!pendingRemoval;
      modes.append(control);
    }
    dialog.append(modes);
    const monthLabel = node('label', 'upload-label', t('uploadMonth'));
    const months = node('select'); months.dataset.focusKey = 'month'; months.setAttribute('aria-label', t('uploadMonth')); months.disabled = busy || !!pendingRemoval;
    for (const visit of feature.properties.visits) { const option = node('option', '', ui().month(visit.when)); option.value = visit.when; months.append(option); }
    const general = node('option', '', t('uploadUndated')); general.value = ''; months.append(general); months.value = when;
    months.addEventListener('change', () => { when = months.value; render(); }); monthLabel.append(months); dialog.append(monthLabel);
    dialog.append(syncStatusElement(feature.id));
    if (mode === 'add') {
      const input = node('input', 'sr-only'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.multiple = true; input.tabIndex = -1; input.disabled = busy;
      input.setAttribute('aria-label', t('uploadChoose'));
      input.addEventListener('change', () => choose(input.files));
      const drop = button('', () => input.click()); drop.dataset.focusKey = 'choose'; drop.className = 'upload-drop'; drop.disabled = busy || photos.length >= uploadLimits.batch;
      drop.append(node('strong', '', t('uploadDrop')), node('span', '', t('uploadChoose')), node('small', '', t('uploadFormats', { count: uploadLimits.batch })));
      let depth = 0;
      drop.addEventListener('dragenter', event => { event.preventDefault(); depth++; drop.classList.add('is-dragging'); });
      drop.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; });
      drop.addEventListener('dragleave', () => { if (--depth <= 0) drop.classList.remove('is-dragging'); });
      drop.addEventListener('drop', event => { event.preventDefault(); depth = 0; drop.classList.remove('is-dragging'); choose(event.dataTransfer.files); });
      dialog.append(input, drop);
    }
    if (mode === 'add' && photos.length) {
      const queue = node('div', 'upload-queue');
      photos.forEach((photo, index) => {
        const row = node('div', 'upload-row'), image = node('img'); image.src = photo.url; image.alt = t('uploadPreviewAlt', { number: index + 1 });
        const copy = node('div', 'upload-photo-copy');
        copy.append(node('span', 'upload-filename', photo.name), node('small', '', `${Math.round(photo.blob.size / 1024)} KB · ${t('uploadPending')}`));
        const label = node('label', 'upload-label', t('uploadCaption', { number: index + 1 }));
        const caption = node('input'); caption.dataset.focusKey = `caption-${index}`; caption.type = 'text'; caption.maxLength = albumLimits.caption; caption.value = photo.caption; caption.placeholder = t('uploadCaptionHint'); caption.disabled = busy;
        caption.addEventListener('input', () => { photo.caption = caption.value; }); label.append(caption); copy.append(label);
        row.append(image, copy);
        const remove = button(t('uploadRemove'), () => { URL.revokeObjectURL(photo.url); photos.splice(index, 1); error = ''; render(); }); remove.dataset.focusKey = `remove-${index}`; remove.setAttribute('aria-label', t('uploadRemovePhoto', { number: index + 1 })); remove.disabled = busy; row.append(remove);
        queue.append(row);
      }); dialog.append(queue);
    }
    if (mode === 'add') dialog.append(node('p', 'upload-copy', t('uploadPublicNotice')));
    if (mode === 'manage') {
      if (pendingRemoval) {
        const confirmation = node('section', 'upload-confirmation');
        const heading = node('h3', '', t('uploadConfirmTitle')); heading.tabIndex = -1;
        const image = node('img'); image.dataset.savedPhoto = pendingRemoval.src; image.src = sync.previewURL(pendingRemoval.src) || pendingRemoval.src; image.alt = pendingRemoval.caption || t('uploadStoredPhoto', { number: pendingRemoval.number });
        confirmation.append(heading, image, node('p', 'upload-photo-context', [ui().city(feature.properties), pendingRemoval.when ? ui().month(pendingRemoval.when) : t('uploadUndated'), pendingRemoval.caption].filter(Boolean).join(' · ')));
        confirmation.append(node('p', 'upload-copy', t('uploadConfirmCopy')));
        dialog.append(confirmation);
      } else if (session && snapshot) {
        const entries = snapshot.albums.albums?.find(album => album.cityId === feature.id && (album.when || '') === when)?.photos || [];
        if (!snapshot.canRemove) dialog.append(node('p', 'upload-copy', t('uploadRemovalUnavailable')));
        if (!entries.length) dialog.append(node('p', 'upload-copy', t('uploadEmptyAlbum')));
        const list = node('div', 'upload-existing');
        entries.forEach((photo, index) => {
          const row = node('div', 'upload-row'), image = node('img'); image.dataset.savedPhoto = photo.src; image.src = sync.previewURL(photo.src) || photo.src; image.alt = photo.caption || t('uploadStoredPhoto', { number: index + 1 }); image.loading = 'lazy';
          const copy = node('div', 'upload-photo-copy'); copy.append(node('span', 'upload-filename', photo.caption || t('uploadStoredPhoto', { number: index + 1 })), node('small', '', when ? ui().month(when) : t('uploadUndated')));
          const key = `stored-${index}`;
          const remove = button(t('uploadRemove'), () => {
            pendingRemoval = { ...photo, when, number: index + 1, key }; error = ''; status = ''; render();
            dialog.querySelector('[data-focus-key="cancel-removal"]').focus();
          });
          remove.dataset.focusKey = key; remove.setAttribute('aria-label', t('uploadRemoveStored', { number: index + 1 })); remove.disabled = busy || !snapshot.canRemove || refreshRequired;
          row.append(image, copy, remove); list.append(row);
        }); dialog.append(list);
      }
    }
    const existing = snapshot?.albums.albums?.find(album => album.cityId === feature.id && (album.when || '') === when)?.photos?.length || 0;
    const full = mode === 'add' && existing + photos.length > albumLimits.photos;
    const message = node('p', 'upload-status', error ? errorText(error) : full ? errorText('album_full') : status ? t(status) : photos.length ? t('uploadLocalDraft') : '');
    message.setAttribute('role', error || full ? 'alert' : 'status'); message.setAttribute('aria-live', 'polite'); dialog.append(message);
    const actions = node('div', 'upload-actions');
    if (refreshRequired || (session && !snapshot)) { const reload = button(t('uploadReload'), refresh); reload.disabled = busy; actions.append(reload); }
    if (mode === 'manage' && pendingRemoval) {
      const cancel = button(t('uploadKeepPhoto'), cancelRemoval); cancel.dataset.focusKey = 'cancel-removal'; cancel.disabled = busy;
      const remove = button(t(busy && status === 'uploadRemoving' ? 'uploadRemoving' : 'uploadConfirmRemove'), confirmRemoval); remove.classList.add('danger');
      remove.disabled = busy || !session || !snapshot?.canRemove || refreshRequired;
      actions.append(cancel, remove);
    } else if (mode === 'add') {
      const submit = button(t(busy && status === 'uploadSaving' ? 'uploadSaving' : 'uploadSave'), save, true);
      submit.disabled = busy || !service || !session || !snapshot || !photos.length || full || refreshRequired;
      actions.append(submit);
    }
    dialog.append(actions);
    if (active && dialog.open) {
      const controls = [...dialog.querySelectorAll('[data-focus-key]')];
      let target = controls.find(control => control.dataset.focusKey === active && !control.disabled);
      if (!target && active.startsWith('remove-')) target = controls.filter(control => control.dataset.focusKey.startsWith('remove-') && !control.disabled).at(-1) || dialog.querySelector('.upload-drop:not(:disabled)');
      (target || title).focus({ preventScroll: true });
    }
    dialog.scrollTop = scroll;
  }
  // Dropping outside the bounded drop zone must not navigate away from the draft.
  dialog.addEventListener('dragover', event => event.preventDefault());
  dialog.addEventListener('drop', event => event.preventDefault());
  ownerSession.subscribe(() => {
    session = ownerSession.current();
    if (!session) snapshot = null;
    if (feature && dialog.open && !busy) render();
  });
  return {
    open(city, trigger, initialMode = 'add') {
      if (feature?.id !== city.id) {
        if (photos.length && !window.confirm(t('uploadDiscard'))) return;
        cleanDraft(); mode = initialMode; feature = city; when = city.properties.visits.at(-1)?.when || '';
      } else {
        if (mode !== initialMode) {
          if (photos.length && !window.confirm(t('uploadSwitchDiscard'))) return;
          cleanDraft(); mode = initialMode;
        }
        feature = city;
      }
      opener = trigger; render(); dialog.showModal();
      if (session && (!snapshot || refreshRequired || Date.now() - snapshotAt > 60_000)) refresh();
    },
    syncStatusElement,
    previewURL: src => sync.previewURL(src),
    updateLanguage() { if (feature) render(); updateSyncStatus(); }
  };
}
