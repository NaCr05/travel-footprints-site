import { albumLimits, uploadLimits, albumChangePublished } from './album-model.js';
import { uploadServiceURL } from './upload-config.js';

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

export function createPhotoUploader({ getUI, onPublished }) {
  const dialog = node('dialog', 'upload-dialog'); dialog.setAttribute('aria-labelledby', 'upload-title');
  document.body.append(dialog);
  const service = uploadServiceURL.replace(/\/$/, '');
  let session = null, feature = null, photos = [], when = '', snapshot = null, busy = false, saved = null, status = '', error = '', refreshRequired = false, opener;
  let mode = 'add', pendingRemoval = null;
  const ui = () => getUI(), t = (key, params) => ui().t(key, params);
  const errorText = code => { try { return t(`uploadError_${code}`); } catch { return t('uploadError_service_unavailable'); } };
  const button = (text, action, primary = false) => { const item = node('button', `upload-button${primary ? ' primary' : ''}`, text); item.type = 'button'; item.dataset.focusKey = action.name || text; item.addEventListener('click', action); return item; };
  function cleanDraft() { photos.forEach(photo => URL.revokeObjectURL(photo.url)); photos = []; snapshot = null; saved = null; pendingRemoval = null; status = ''; error = ''; refreshRequired = false; }
  function close() { if (!busy) { pendingRemoval = null; dialog.close(); } }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => (opener?.isConnected ? opener : document.querySelector('.album-add'))?.focus({ preventScroll: true }));
  window.addEventListener('beforeunload', event => { if ((photos.length && !saved) || busy) { event.preventDefault(); event.returnValue = ''; } });

  async function api(path, options = {}) {
    if (!session || session.exp <= Date.now()) { session = null; throw new Error('login_required'); }
    let response;
    try { response = await fetch(`${service}${path}`, { ...options, headers: { Authorization: `Bearer ${session.value}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store', signal: AbortSignal.timeout(90_000) }); }
    catch { throw new Error('connection'); }
    const result = await response.json().catch(() => ({ error: 'service_unavailable' }));
    if (!response.ok) { if (response.status === 401) session = null; throw new Error(result.error); }
    return result;
  }
  async function refresh() {
    busy = true; error = ''; pendingRemoval = null; status = 'uploadReading'; render();
    try { snapshot = await api('/api/snapshot'); refreshRequired = false; status = 'uploadReady'; }
    catch (failure) { error = failure.message; status = ''; }
    finally { busy = false; render(); }
  }
  async function login() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    const popup = window.open(`${service}/auth/start?nonce=${nonce}`, 'footprints-owner-login', 'popup,width=560,height=700');
    if (!popup) { error = 'popup_blocked'; render(); return; }
    busy = true; error = ''; status = 'uploadSigningIn'; render();
    try {
      session = await new Promise((resolve, reject) => {
        const finish = (failure, value) => { window.removeEventListener('message', receive); clearInterval(closed); clearTimeout(timeout); failure ? reject(failure) : resolve(value); };
        const receive = event => {
          if (event.origin !== new URL(service).origin || event.source !== popup || event.data?.type !== 'footprints-auth' || event.data?.nonce !== nonce) return;
          if (event.data.error) finish(new Error(event.data.error));
          else if (typeof event.data.session === 'string' && Number.isFinite(event.data.exp)) finish(null, { value: event.data.session, login: event.data.login, exp: event.data.exp });
        };
        window.addEventListener('message', receive);
        const closed = setInterval(() => { if (popup.closed) finish(new Error('login_cancelled')); }, 1000);
        const timeout = setTimeout(() => finish(new Error('login_cancelled')), 5 * 60_000);
      });
      snapshot = await api('/api/snapshot'); refreshRequired = false; status = 'uploadReady';
    } catch (failure) { error = failure.message; status = ''; }
    finally { busy = false; render(); }
  }
  async function logout() {
    busy = true; error = ''; render();
    try { await api('/api/logout', { method: 'POST' }); session = null; snapshot = null; status = ''; }
    catch (failure) { error = failure.message; }
    finally { busy = false; render(); }
  }
  async function choose(files) {
    if (busy || saved) return;
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
    if (busy || saved || !photos.length || !snapshot || !session || refreshRequired) return;
    busy = true; error = ''; status = 'uploadSaving'; render();
    try {
      const result = await api('/api/photos', { method: 'POST', body: JSON.stringify({ base: snapshot.head, cityId: feature.id, when, photos: photos.map(({ content, caption }) => ({ content, caption })) }) });
      saved = { ...result, when }; status = 'uploadSaved';
    } catch (failure) { error = failure.message; status = ''; refreshRequired = failure.message === 'conflict'; }
    finally { busy = false; render(); }
  }
  function switchMode(next) {
    if (busy || next === mode) return;
    if (photos.length && !saved && !window.confirm(t('uploadSwitchDiscard'))) return;
    cleanDraft(); mode = next; render();
    if (session) refresh();
  }
  function cancelRemoval() {
    const key = pendingRemoval?.key;
    pendingRemoval = null; error = ''; status = ''; render();
    [...dialog.querySelectorAll('[data-focus-key]')].find(control => control.dataset.focusKey === key)?.focus();
  }
  async function confirmRemoval() {
    if (busy || saved || !pendingRemoval || !session || !snapshot?.canRemove || refreshRequired) return;
    busy = true; error = ''; status = 'uploadRemoving'; render();
    try {
      const result = await api('/api/photos', { method: 'DELETE', body: JSON.stringify({ base: snapshot.head, cityId: feature.id, when: pendingRemoval.when, src: pendingRemoval.src }) });
      saved = { ...result, when: pendingRemoval.when }; status = 'uploadRemoved';
    } catch (failure) { error = failure.message; status = ''; refreshRequired = failure.message === 'conflict'; }
    finally { busy = false; render(); }
  }
  async function checkPublished() {
    if (busy || !saved) return;
    busy = true; error = ''; status = 'uploadChecking'; render();
    try {
      const url = new URL('./data/places.geojson', document.baseURI); url.searchParams.set('check', Date.now());
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('connection');
      const data = await response.json();
      if (!albumChangePublished(data, feature.id, saved)) { status = saved.removed ? 'uploadRemovalWaiting' : 'uploadWaiting'; }
      else {
        // A data response alone is not proof that the images are available.
        for (const photo of saved.photos || []) {
          const response = await fetch(new URL(photo.src, document.baseURI), { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
          if (!response.ok) throw new Error('connection');
        }
        status = saved.removed ? 'uploadRemovalPublished' : 'uploadPublished'; saved.published = true; onPublished(data.features);
      }
    } catch (failure) { error = failure.message; status = saved.removed ? 'uploadRemoved' : 'uploadSaved'; }
    finally { busy = false; render(); }
  }
  function render() {
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
      control.dataset.focusKey = `mode-${value}`; control.setAttribute('aria-pressed', String(mode === value)); control.disabled = busy || !!saved || !!pendingRemoval;
      modes.append(control);
    }
    dialog.append(modes);
    const monthLabel = node('label', 'upload-label', t('uploadMonth'));
    const months = node('select'); months.dataset.focusKey = 'month'; months.setAttribute('aria-label', t('uploadMonth')); months.disabled = busy || !!saved || !!pendingRemoval;
    for (const visit of feature.properties.visits) { const option = node('option', '', ui().month(visit.when)); option.value = visit.when; months.append(option); }
    const general = node('option', '', t('uploadUndated')); general.value = ''; months.append(general); months.value = when;
    months.addEventListener('change', () => { when = months.value; render(); }); monthLabel.append(months); dialog.append(monthLabel);
    if (mode === 'add' && !saved) {
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
        copy.append(node('span', 'upload-filename', photo.name), node('small', '', `${Math.round(photo.blob.size / 1024)} KB · ${t(saved ? 'uploadInRepository' : 'uploadPending')}`));
        const label = node('label', 'upload-label', t('uploadCaption', { number: index + 1 }));
        const caption = node('input'); caption.dataset.focusKey = `caption-${index}`; caption.type = 'text'; caption.maxLength = albumLimits.caption; caption.value = photo.caption; caption.placeholder = t('uploadCaptionHint'); caption.disabled = busy || !!saved;
        caption.addEventListener('input', () => { photo.caption = caption.value; }); label.append(caption); copy.append(label);
        row.append(image, copy);
        if (!saved) { const remove = button(t('uploadRemove'), () => { URL.revokeObjectURL(photo.url); photos.splice(index, 1); error = ''; render(); }); remove.dataset.focusKey = `remove-${index}`; remove.setAttribute('aria-label', t('uploadRemovePhoto', { number: index + 1 })); remove.disabled = busy; row.append(remove); }
        queue.append(row);
      }); dialog.append(queue);
    }
    if (mode === 'add' && !saved) dialog.append(node('p', 'upload-copy', t('uploadPublicNotice')));
    if (mode === 'manage') {
      if (pendingRemoval) {
        const confirmation = node('section', 'upload-confirmation');
        const heading = node('h3', '', t(saved ? 'uploadRemovalTitle' : 'uploadConfirmTitle')); heading.tabIndex = -1;
        const image = node('img'); image.src = pendingRemoval.src; image.alt = pendingRemoval.caption || t('uploadStoredPhoto', { number: pendingRemoval.number });
        confirmation.append(heading, image, node('p', 'upload-photo-context', [ui().city(feature.properties), pendingRemoval.when ? ui().month(pendingRemoval.when) : t('uploadUndated'), pendingRemoval.caption].filter(Boolean).join(' · ')));
        if (!saved) confirmation.append(node('p', 'upload-copy', t('uploadConfirmCopy')));
        dialog.append(confirmation);
      } else if (session && snapshot) {
        const entries = snapshot.albums.albums?.find(album => album.cityId === feature.id && (album.when || '') === when)?.photos || [];
        if (!snapshot.canRemove) dialog.append(node('p', 'upload-copy', t('uploadRemovalUnavailable')));
        if (!entries.length) dialog.append(node('p', 'upload-copy', t('uploadEmptyAlbum')));
        const list = node('div', 'upload-existing');
        entries.forEach((photo, index) => {
          const row = node('div', 'upload-row'), image = node('img'); image.src = photo.src; image.alt = photo.caption || t('uploadStoredPhoto', { number: index + 1 }); image.loading = 'lazy';
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
    if (saved) {
      if (!saved.published) { const check = button(t('uploadCheck'), checkPublished, true); check.disabled = busy; actions.append(check); }
      const again = button(t(saved.removed ? 'uploadBackToAlbum' : 'uploadMore'), () => { cleanDraft(); render(); if (session) refresh(); }); again.disabled = busy; actions.append(again);
    } else {
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
  return {
    open(city, trigger, initialMode = 'add') {
      if (feature?.id !== city.id) {
        if (photos.length && !saved && !window.confirm(t('uploadDiscard'))) return;
        cleanDraft(); mode = initialMode; feature = city; when = city.properties.visits.at(-1)?.when || '';
      } else {
        if (!saved && mode !== initialMode) {
          if (photos.length && !window.confirm(t('uploadSwitchDiscard'))) return;
          cleanDraft(); mode = initialMode;
        }
        feature = city;
      }
      opener = trigger; render(); dialog.showModal();
      if (session && !saved && (!snapshot || mode === 'manage')) refresh();
    },
    updateLanguage() { if (feature) render(); }
  };
}
