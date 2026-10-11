import { ownerSession } from './owner-session.js';
import { validateWishlist } from './wishlist-model.js';

// WORLD: the incumbent quiet charcoal map, cyan visits and 6px champagne rings.
// STORY: browse places to go; the owner can save a public reason without leaving the map.
// FIRST VIEWPORT: map remains dominant; wishlist rows live in the existing sidebar.
// FORM: existing sidebar, inline search and edit states; no additional modal layer.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const glyph = () => { const span = el('span', 'wish-symbol'); span.setAttribute('aria-hidden', 'true'); return span; };
export const publicationIncludes = (doc, commit) => !!commit && Array.isArray(doc?.publication?.commits) && doc.publication.commits.includes(commit);

export function createWishlistView({ getUI, onUpdate, onSelect, openVisited, isVisible }) {
  const root = el('div', 'wishlist-view');
  let doc = { schemaVersion: 1, cities: [] }, mode = 'list', selectedId = null, draft = null, reason = '', removing = false;
  let busy = '', error = '', loadFailed = false, head = null, conflict = false;
  let ideas = null, query = '', country = 'all', results = [], searchBusy = false, searchError = false, searchGeneration = 0, searchTimer;
  let worker, requestId = 0, pending = new Map(), phase = '', publication = null, publicationTimer, checks = 0;
  const ui = () => getUI(), t = (key, params) => ui().t(key, params);
  const name = city => ui().language === 'zh' ? city.nameZh || city.nameEn : city.nameEn;
  const place = city => [new Intl.DisplayNames([ui().language], { type: 'region' }).of(city.countryCode), city.region].filter(Boolean).join(' / ');
  const button = (key, action, cls = 'wish-button') => { const b = el('button', cls, t(key)); b.type = 'button'; b.addEventListener('click', action); b.disabled = !!busy; b.dataset.wishFocus = key; return b; };
  const selected = () => draft || doc.cities.find(c => c.id === selectedId);
  function focusResult(selector) {
    if (root.isConnected && !root.closest('[inert], [hidden]')) root.querySelector(selector)?.focus({ preventScroll: true });
  }
  function update(next) { doc = validateWishlist(next); onUpdate(doc); }
  function failureText() {
    if (conflict) return t('wishConflict');
    if (error === 'wishlist_full') return t('wishFull');
    if (error === 'invalid_reason') return t('wishReasonError');
    if (loadFailed) return t('wishLoadError');
    try { return t(`uploadError_${error}`); } catch { return t('uploadError_service_unavailable'); }
  }
  async function load() {
    try {
      const response = await fetch(new URL('./data/wishlist.json', document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('connection');
      const next = validateWishlist(await response.json());
      // A stale static build must never undo a save already confirmed by GitHub.
      if (!publication || publicationIncludes(next, publication)) update(next);
      loadFailed = false; error = '';
    } catch { loadFailed = true; error = 'connection'; }
    render();
  }
  async function refresh() {
    if (busy) return;
    busy = 'wishReading'; error = ''; render();
    try { const result = await ownerSession.request('/api/wishlist'); update(result.wishlist); head = result.head; conflict = false; loadFailed = false; }
    catch (failure) { error = failure.message; }
    finally { busy = ''; render(); focusResult(error ? '.wish-status' : mode === 'edit' ? 'textarea' : '[data-wish-focus="wishAdd"]'); }
  }
  async function login() {
    if (busy) return;
    busy = 'wishSigningIn'; error = ''; render();
    try { await ownerSession.signIn(); busy = ''; await refresh(); }
    catch (failure) { error = failure.message; }
    finally { busy = ''; render(); focusResult(error ? '.wish-status' : mode === 'edit' ? 'textarea' : '[data-wish-focus="wishAdd"]'); }
  }
  async function logout() {
    if (busy) return;
    busy = 'wishReading'; render();
    try { await ownerSession.signOut(); head = null; }
    catch (failure) { error = failure.message; }
    finally { busy = ''; render(); focusResult(error ? '.wish-status' : '[data-wish-focus="wishLogin"]'); }
  }
  ownerSession.subscribe(() => { if (!ownerSession.current()) head = null; if (!busy) render(); });

  function searchCities(value, filter) {
    worker ||= new Worker(new URL('./city-search-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { const request = pending.get(data.id); if (!request) return; pending.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.cities); };
    worker.onerror = () => { pending.forEach(p => p.reject(new Error('catalog_unavailable'))); pending.clear(); worker.terminate(); worker = null; };
    return new Promise((resolve, reject) => { const id = ++requestId; pending.set(id, { resolve, reject }); worker.postMessage({ id, query: value, country: filter }); });
  }
  async function loadIdeas() {
    if (ideas) return;
    try {
      const response = await fetch(new URL('./data/cities/index.json', document.baseURI), { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error();
      ideas = (await response.json()).recommended; searchError = false;
    } catch { searchError = true; }
    renderSearchResults();
  }
  function beginSearch() {
    if (!canLeave()) return;
    mode = 'search'; draft = null; error = ''; removing = false; render();
    root.querySelector('input')?.focus(); loadIdeas();
    if (ownerSession.current() && !head) refresh();
  }
  function runSearch() {
    clearTimeout(searchTimer);
    const generation = ++searchGeneration;
    searchError = false; searchBusy = !!query.trim(); renderSearchResults();
    if (!query.trim()) return;
    searchTimer = setTimeout(async () => {
      try { const matches = await searchCities(query, country); if (generation !== searchGeneration) return; results = matches; }
      catch { if (generation !== searchGeneration) return; searchError = true; }
      finally { if (generation === searchGeneration) { searchBusy = false; renderSearchResults(); } }
    }, 200);
  }
  function choose(city) {
    if (busy) return;
    const existing = doc.cities.find(c => c.id === city.id);
    if (existing) { draft = null; onSelect(existing.id); return; }
    draft = city; selectedId = null; reason = ''; mode = 'edit'; removing = false; error = ''; render();
    root.querySelector('textarea')?.focus();
  }
  function renderSearchResults() {
    const host = root.querySelector('.wish-search-results'); if (!host) return;
    host.replaceChildren();
    if (searchError) { host.append(el('p', 'wish-error', t('wishCatalogError')), button('retry', () => { searchError = false; if (query.trim()) runSearch(); else loadIdeas(); })); return; }
    if (searchBusy || !query.trim() && !ideas) { host.append(el('p', 'wish-copy', t(query.trim() ? 'wishSearching' : 'wishCatalogLoading'))); return; }
    const cities = query.trim() ? results : (ideas || []).filter(c => country === 'all' || (country === 'CN') === ['CN', 'HK', 'MO'].includes(c.countryCode)).slice(0, 12);
    host.append(el('h3', '', t(query.trim() ? 'wishSearchResults' : 'wishIdeas')));
    host.append(el('p', 'wish-copy', t(query.trim() ? 'wishSearchFootnote' : 'wishCurated')));
    if (!cities.length) host.append(el('h4', '', t('wishNoResults')), el('p', 'wish-copy', t('wishSearchHint')));
    const list = el('div', 'wish-results');
    for (const city of cities) {
      const row = el('button', 'wish-result'); row.type = 'button'; row.disabled = !!busy;
      const copy = el('span', 'wish-result-copy'); copy.append(el('strong', '', name(city)), el('small', '', place(city)));
      if (doc.cities.some(c => c.id === city.id)) copy.append(el('small', 'wish-already', t('wishAlready')));
      else if (city.visitedId) copy.append(el('small', '', t('wishVisited')));
      row.append(glyph(), copy); row.addEventListener('click', () => choose(city)); list.append(row);
    }
    host.append(list);
  }
  function statusText() { return busy ? t(busy) : error ? failureText() : phase && ['list', 'detail'].includes(mode) ? t({ pending: 'wishPending', published: 'wishPublished', delayed: 'wishDelayed' }[phase]) : ''; }
  function updateStatus() {
    const host = root.querySelector('.wish-status'); if (!host) return;
    host.textContent = statusText(); host.classList.toggle('wish-error', !!error); host.hidden = !host.textContent;
    const check = root.querySelector('[data-wish-focus="wishCheck"]'); if (check) check.hidden = phase !== 'delayed' || !['list', 'detail'].includes(mode);
  }
  async function checkPublication() {
    clearTimeout(publicationTimer);
    const checking = publication;
    if (!checking) return;
    if (navigator.onLine === false || document.hidden) { publicationTimer = setTimeout(checkPublication, 30_000); return; }
    try {
      const url = new URL('./data/wishlist.json', document.baseURI); url.searchParams.set('check', Date.now());
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (response.ok) {
        const next = validateWishlist(await response.json());
        if (checking === publication && publicationIncludes(next, checking)) { publication = null; phase = 'published'; update(next); render(); return; }
      }
    } catch { /* Keep the confirmed list when publication or the network is slow. */ }
    if (checking !== publication) return;
    if (++checks >= 10) phase = 'delayed';
    else publicationTimer = setTimeout(checkPublication, 30_000);
    updateStatus();
  }
  async function save(remove = false) {
    const city = selected();
    if (busy || !city) return;
    if (!ownerSession.current()) { head = null; error = 'login_required'; render(); focusResult('[data-wish-focus="wishLogin"]'); return; }
    if (!head || conflict) return;
    busy = remove ? 'wishRemoving' : 'wishSaving'; error = ''; render();
    try {
      const result = await ownerSession.request('/api/wishlist', { method: remove ? 'DELETE' : 'POST', body: JSON.stringify({ base: head, id: city.id, ...(!remove ? { reason } : {}) }) });
      update(result.wishlist); head = result.commit; conflict = false; draft = null; removing = false;
      if (!result.unchanged) { publication = result.commit; phase = 'pending'; checks = 0; clearTimeout(publicationTimer); publicationTimer = setTimeout(checkPublication, 15_000); }
      mode = remove ? 'list' : 'detail'; selectedId = remove ? null : city.id;
      busy = '';
      onSelect(selectedId);
    } catch (failure) { error = failure.message; conflict = error === 'conflict'; }
    finally { busy = ''; render(); focusResult(error ? '.wish-status' : remove ? '[data-wish-focus="wishAdd"]' : '.wish-city-title'); }
  }
  function render() {
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.dataset.wishFocus, selection = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = root.parentElement?.scrollTop || 0;
    root.replaceChildren();
    root.classList.toggle('wish-search-mode', mode === 'search');
    if (mode !== 'list') root.append(button('wishBack', () => { if (!canLeave()) return; mode = 'list'; draft = null; removing = false; onSelect(null); }, 'detail-back'));
    const status = el('p', 'wish-status'); status.setAttribute('role', 'status'); status.tabIndex = -1; status.dataset.wishFocus = 'status'; root.append(status);
    const retryPublish = button('wishCheck', () => { checks = 0; phase = 'pending'; checkPublication(); updateStatus(); }); retryPublish.hidden = phase !== 'delayed'; root.append(retryPublish);
    if (loadFailed) root.append(button('retry', load));
    if (ownerSession.current()) {
      const account = el('div', 'wish-account'); account.append(el('span', '', t('wishSignedIn', { login: ownerSession.current().login })), button('uploadSignOut', logout, 'wish-link')); root.append(account);
    }
    if (conflict || ownerSession.current() && !head) root.append(button('wishReload', refresh));
    if (mode === 'list') {
      const actions = el('div', 'wish-actions'); actions.append(button('wishAdd', beginSearch, 'wish-button primary'));
      if (!ownerSession.current()) actions.append(button('wishLogin', login, 'wish-link'));
      root.append(actions);
      if (!doc.cities.length && !loadFailed) { const empty = el('div', 'wish-empty'); empty.append(glyph(), el('h3', '', t('wishEmpty')), el('p', '', t('wishEmptyHint'))); root.append(empty); }
      const list = el('div', 'wish-list');
      for (const city of [...doc.cities].reverse()) {
        const row = el('button', 'wish-result'); row.type = 'button'; row.disabled = !!busy;
        const copy = el('span', 'wish-result-copy'); copy.append(el('strong', '', name(city)), el('small', '', place(city)));
        if (city.reason) copy.append(el('span', 'wish-excerpt', city.reason));
        row.append(glyph(), copy); row.addEventListener('click', () => { draft = null; onSelect(city.id); }); list.append(row);
      }
      root.append(list, el('p', 'wish-copy wish-public', t('wishPublic')));
    } else if (mode === 'search') {
      const label = el('label', 'wish-search-label', t('wishSearchLabel')), input = el('input'); input.type = 'search'; input.placeholder = t('wishSearch'); input.value = query; input.autocomplete = 'off'; input.dataset.wishFocus = 'query';
      input.addEventListener('input', () => { query = input.value; runSearch(); }); label.append(input); root.append(label);
      const tabs = el('div', 'wish-country-tabs');
      for (const [value, key] of [['all', 'wishAll'], ['CN', 'wishChina'], ['other', 'wishAbroad']]) {
        const b = button(key, () => { country = value; render(); runSearch(); }); b.setAttribute('aria-pressed', String(country === value)); tabs.append(b);
      }
      const host = el('div', 'wish-search-results'); host.setAttribute('aria-live', 'polite'); root.append(tabs, host); renderSearchResults();
    } else {
      const city = selected();
      if (!city) root.append(el('p', 'wish-copy', t('wishUnavailable')));
      else {
        const h3 = el('h3', 'wish-city-title', name(city)); h3.tabIndex = -1; h3.dataset.wishFocus = 'city-title'; root.append(h3, el('p', 'wish-location', place(city)));
        if (ui().language === 'zh' && city.nameZh) root.append(el('p', 'wish-copy', city.nameEn));
        const tag = el('p', 'wish-tag', t(city.visitedId ? 'wishVisited' : 'wishTag')); tag.prepend(glyph()); root.append(tag);
        if (mode === 'edit') {
          const label = el('label', 'wish-reason-label'); label.append(el('span', '', t('wishReason')), el('small', '', t('wishOptional')));
          const field = el('textarea'); field.rows = 4; field.maxLength = 500; field.placeholder = t('wishReasonHint'); field.value = reason; field.disabled = !!busy; field.dataset.wishFocus = 'reason';
          const counter = el('span', 'wish-counter', t('wishCharacters', { count: reason.length }));
          field.addEventListener('input', () => { reason = field.value; counter.textContent = t('wishCharacters', { count: reason.length }); }); label.append(field, counter); root.append(label);
          if (ownerSession.current()) { const submit = button(draft ? 'wishSave' : 'wishSaveEdit', () => save(), 'wish-button primary'); submit.disabled = !!busy || !head || conflict; root.append(submit); }
          else root.append(button('wishLogin', login, 'wish-button primary'));
          root.append(button(draft ? 'wishBackSearch' : 'wishCancel', () => { if (draft) beginSearch(); else { mode = 'detail'; render(); } }));
        } else {
          root.append(el('h4', 'wish-reason-title', t('wishReason')), el('p', city.reason ? 'wish-reason' : 'wish-copy', city.reason || t('wishNoReason')));
          if (ownerSession.current()) {
            if (removing) {
              const confirm = el('div', 'wish-confirm'); confirm.append(el('p', '', t('wishConfirmRemove', { city: name(city) })), el('p', 'wish-copy', t('wishRemoveHint')), button('wishRemove', () => save(true), 'wish-button danger'), button('wishCancel', () => { removing = false; render(); })); root.append(confirm);
            } else { const actions = el('div', 'wish-actions'); actions.append(button('wishEdit', () => { mode = 'edit'; reason = city.reason; render(); root.querySelector('textarea')?.focus(); }), button('wishRemove', () => { removing = true; render(); }, 'wish-link')); root.append(actions); }
          } else root.append(button('wishLogin', login));
          if (city.visitedId) root.append(button('wishVisitedLink', () => openVisited(city.visitedId), 'wish-link'));
        }
      }
    }
    if (!isVisible()) root.append(el('p', 'wish-copy wish-hidden-note', t('wishHidden')));
    updateStatus();
    if (focusKey) {
      const target = [...root.querySelectorAll('[data-wish-focus]')].find(n => n.dataset.wishFocus === focusKey);
      target?.focus({ preventScroll: true }); if (target && selection && typeof target.setSelectionRange === 'function') target.setSelectionRange(...selection);
    }
    if (root.parentElement) root.parentElement.scrollTop = scroll;
  }
  window.addEventListener('beforeunload', event => { if (busy || mode === 'edit' && reason !== (draft ? '' : selected()?.reason || '')) { event.preventDefault(); event.returnValue = ''; } });
  function canLeave() { return !busy && (mode !== 'edit' || reason === (draft ? '' : selected()?.reason || '') || window.confirm(t('wishDiscard'))); }
  return { root, load, render, name, place, selected, canLeave,
    focusList() { focusResult('[data-wish-focus="wishAdd"]'); },
    route(id) { if (id === selectedId && mode === 'edit' && !draft) return; selectedId = id; draft = null; mode = id ? 'detail' : 'list'; removing = false; render(); if (ownerSession.current() && !head) refresh(); },
    count: () => doc.cities.length
  };
}
