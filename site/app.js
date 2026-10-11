import { Map as AtlasMap, Marker, Popup, LngLat, setWorkerUrl } from '../vendor/maplibre/maplibre-gl.mjs';
import { filterPlaces, timelineGroups, safeAssetURL, photoEntries } from './model.js';
import { createI18n, resolveLanguage, LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE } from './i18n.js';
import { toDisplayCoordinates, projectCountries } from './projection.js';
import { createPhotoUploader } from './photo-upload.js';
import { createAlbumView } from './album-view.js';

const $ = selector => document.querySelector(selector);
const icons = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 15.1A8.3 8.3 0 0 1 8.9 4a8.3 8.3 0 1 0 11.1 11.1Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  cross: '<path d="m6 6 12 12M6 18 18 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-12 4h3"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m5 18 5-5 3 3 3-5 5 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
// Keep navigation immediate; long flyovers obscure the record just selected
// and may be throttled in embedded/background browser previews.
const motion = () => 0;
let language = DEFAULT_LANGUAGE;
try { language = resolveLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)); } catch { /* English is also the storage-free default. */ }
let ui = createI18n(language), lastError = null;
const t = (key, params) => ui.t(key, params);
const state = { tab: 'places', query: '', country: 'all', year: 'all', selected: null, collapsed: true, worldView: true, language };
let features = [], visible = [], world, miniatureWorld, map, popup, mapReady = false, frame;
const markerCache = new globalThis.Map();
const photoUploader = createPhotoUploader({ getUI: () => ui, getFeatures: () => features, onUpdate: updatePhotoFeatures });
const albumView = createAlbumView({ root: $('#albums'), getUI: () => ui, getFeatures: () => features,
  previewURL: src => photoUploader.previewURL(src), openCity: selectCity, openPhoto: showPhoto });
let viewedPhoto = null;
let theme = 'dark';
try { theme = localStorage.getItem('footprints-theme-v2') === 'light' ? 'light' : 'dark'; } catch { /* Storage can be disabled. */ }

$('#search-icon').innerHTML = icon('search');
$('#collapse').innerHTML = `${icon('back')}<span data-i18n="collapse">Hide</span>`;
$('#reset-view').innerHTML = icon('globe');
$('#clear-filters').innerHTML = icon('cross');

function setTheme(next) {
  theme = next;
  document.body.dataset.theme = theme;
  $('#theme').innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
  $('#theme').setAttribute('aria-label', t(theme === 'light' ? 'darkTheme' : 'lightTheme'));
  $('#theme').title = t(theme === 'light' ? 'darkTheme' : 'lightTheme');
  try { localStorage.setItem('footprints-theme-v2', theme); } catch { /* Optional preference only. */ }
  if (mapReady) {
    map.setPaintProperty('ocean', 'background-color', theme === 'light' ? '#edf0f1' : '#232629');
    map.setPaintProperty('land', 'fill-color', theme === 'light' ? '#d4d8db' : '#414145');
    map.setPaintProperty('borders', 'line-color', theme === 'light' ? '#b9c0c5' : '#252629');
  }
}
function renderFilterOptions() {
  const countries = [...new globalThis.Map(features.map(f => [f.properties.countryCode, f.properties]))];
  const allCountries = el('option', '', t('allCountries')); allCountries.value = 'all';
  $('#country').replaceChildren(allCountries);
  countries.forEach(([code, p]) => { const option = el('option', '', ui.country(p)); option.value = code; $('#country').append(option); });
  const allYears = el('option', '', t('allYears')); allYears.value = 'all';
  $('#year').replaceChildren(allYears);
  const years = [...new Set(features.flatMap(f => f.properties.visits.map(v => v.when.slice(0, 4))))].sort().reverse();
  years.forEach(year => { const option = el('option', '', t('yearOption', { year })); option.value = year; $('#year').append(option); });
  $('#country').value = state.country; $('#year').value = state.year;
}

function setLanguage(value, persist = true) {
  language = resolveLanguage(value); state.language = language; ui = createI18n(language);
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = t('pageTitle'); $('meta[name="description"]').content = t('description');
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  for (const [data, attr] of [['i18nLabel', 'aria-label'], ['i18nTitle', 'title'], ['i18nPlaceholder', 'placeholder']]) {
    document.querySelectorAll(`[data-${data.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}]`).forEach(node => node.setAttribute(attr, t(node.dataset[data])));
  }
  $('#atlas-summary').textContent = t('atlas'); $('#panel-title').textContent = t('placesTitle');
  renderFilterOptions(); setTheme(theme);
  if (map) map.getCanvas().setAttribute('aria-label', t('canvas'));
  if (features.length) {
    const scroll = $('#content').scrollTop;
    render(); $('#content').scrollTop = scroll;
  }
  if (lastError) showError(lastError);
  photoUploader.updateLanguage();
  if (persist) try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Switching still works without storage. */ }
}
setLanguage(language, false);

function padding() {
  if (state.collapsed) return { top: 16, bottom: 24, left: 20, right: 20 };
  if (innerWidth <= 760) return { top: 24, bottom: Math.ceil($('#panel').getBoundingClientRect().height) + 16, left: 24, right: 38 };
  return { top: 32, bottom: 38, left: Math.ceil($('#panel').getBoundingClientRect().right - $('#map').getBoundingClientRect().left) + 38, right: 42 };
}
function fitPlaces(list, worldView = false, maxZoom = 6.2) {
  if (!mapReady) return;
  state.worldView = worldView;
  popup.remove();
  // flyTo keeps padding on the camera; clear it before computing a new fit,
  // particularly when switching from desktop to the bottom sheet on mobile.
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  if (worldView || !list.length) {
    map.fitBounds([toDisplayCoordinates([-179, -85]), toDisplayCoordinates([179, 85])], { padding: padding(), duration: motion(), maxZoom: 2.5 });
  } else if (list.length === 1) {
    map.flyTo({ center: toDisplayCoordinates(list[0].geometry.coordinates), zoom: 5.3, padding: padding(), duration: motion() });
  } else {
    const lngs = list.map(f => f.geometry.coordinates[0]);
    const lats = list.map(f => f.geometry.coordinates[1]);
    map.fitBounds([toDisplayCoordinates([Math.min(...lngs), Math.min(...lats)]), toDisplayCoordinates([Math.max(...lngs), Math.max(...lats)])], { padding: padding(), maxZoom, duration: motion() });
  }
}
function setCollapsed(value) {
  state.collapsed = value;
  $('#panel').classList.toggle('is-collapsed', value);
  $('#panel').inert = value;
  $('#panel').setAttribute('aria-hidden', String(value));
  $('#show-panel').hidden = !value;
  $('#show-panel').setAttribute('aria-expanded', String(!value));
  $('#collapse').setAttribute('aria-expanded', String(!value));
  document.body.classList.toggle('panel-collapsed', value);
}
function navigate(hash) { if (location.hash === hash) readRoute(); else location.hash = hash; }
function selectCity(f) { setCollapsed(false); navigate(`#/city/${f.id}`); }
function clearFilters() {
  state.country = 'all'; state.year = 'all'; state.query = '';
  $('#country').value = 'all'; $('#year').value = 'all'; $('#search').value = '';
}
function readRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const selected = parts[0] === 'city' ? features.find(f => f.id === parts[1]) : null;
  state.selected = selected?.id || null;
  if (selected) setCollapsed(false);
  if (!selected) state.tab = ['places', 'timeline', 'stats', 'albums'].includes(parts[0]) ? parts[0] : 'places';
  if (selected && !filterPlaces(features, state).some(f => f.id === selected.id)) clearFilters();
  render();
  if (selected) {
    fitPlaces([selected]);
    $('#detail-title').focus({ preventScroll: true });
  } else if (state.tab === 'albums') $('#albums-title').focus({ preventScroll: true });
}

function thumb(f, large = false) {
  const p = f.properties;
  const cover = el('div', `city-cover${large ? ' detail-cover' : ''}`);
  cover.dataset.coverCity = f.id;
  const width = 310, height = large ? 130 : 128;
  const projection = d3.geoMercator().center(f.geometry.coordinates).translate([width * .59, height * .53]).scale(530);
  const path = d3.geoPath(projection);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  const background = document.createElementNS(ns, 'rect');
  background.setAttribute('width', width); background.setAttribute('height', height); background.setAttribute('fill', 'var(--ocean)');
  svg.append(background);
  for (const country of miniatureWorld.features) {
    const node = document.createElementNS(ns, 'path');
    node.setAttribute('d', path(country));
    node.setAttribute('fill', 'var(--land)');
    node.setAttribute('stroke', 'var(--map-border)'); node.setAttribute('stroke-width', '.7');
    svg.append(node);
  }
  const [cx, cy] = projection(f.geometry.coordinates);
  for (const [radius, fill, opacity] of [[7, '#629eb6', '.12'], [3, '#6da9be', '1']]) {
    const circle = document.createElementNS(ns, 'circle');
    for (const [key, val] of Object.entries({ cx, cy, r: radius, fill, opacity })) circle.setAttribute(key, val);
    svg.append(circle);
  }
  cover.append(svg);
  const firstPhoto = photoEntries(p).find(photo => safeAssetURL(photo.src, document.baseURI));
  if (firstPhoto) {
    const img = el('img'); img.src = photoUploader.previewURL(firstPhoto.src) || safeAssetURL(firstPhoto.src, document.baseURI); img.alt = firstPhoto.caption || t('photoAlt', { city: ui.city(p) }); img.loading = 'lazy';
    svg.setAttribute('hidden', ''); cover.append(img); img.addEventListener('error', () => { img.remove(); svg.removeAttribute('hidden'); });
  }
  const tag = el('span', 'country-tag', ui.country(p)); cover.append(tag);
  const [lon, lat] = f.geometry.coordinates;
  cover.append(el('span', 'cover-coordinates', `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`));
  return cover;
}

function renderCard(f) {
  const p = f.properties;
  const button = el('button', 'city-card');
  button.dataset.cityId = f.id; button.setAttribute('aria-label', t('viewCity', { city: ui.city(p), visits: ui.visits(p) }));
  const copy = el('div', 'card-copy'), title = el('div', 'card-title');
  title.append(el('h2', '', ui.city(p)));
  if (language === 'zh' && p.nameEn) title.append(el('span', 'english', p.nameEn));
  title.append(el('span', 'card-arrow', '↗'));
  const date = el('div', 'card-date'); date.innerHTML = icon('calendar');
  if (p.visits.length) date.append(el('span', '', p.visits.map(v => language === 'zh' ? v.when.replace('-', '.') : ui.month(v.when)).join(' / ')));
  else date.append(el('span', `badge ${p.category}`, ui.category(p.category)));
  copy.append(title, date); button.append(copy); button.addEventListener('click', () => selectCity(f));
  return button;
}

function emptyState() {
  const empty = el('div', 'empty-state'); empty.innerHTML = icon('search');
  empty.append(el('h2', '', t('noResults')), el('p', '', t('searchHint')));
  const reset = el('button', '', t('clear')); reset.addEventListener('click', () => { clearFilters(); render(); fitPlaces(visible); }); empty.append(reset);
  return empty;
}
function detailSection(title, iconName) {
  const section = el('section', 'detail-section'), heading = el('h3'); heading.innerHTML = icon(iconName); heading.append(document.createTextNode(title)); section.append(heading); return section;
}
function renderDetail(f) {
  const p = f.properties, section = el('div', 'city-detail');
  const back = el('button', 'detail-back'); back.innerHTML = icon('back'); back.append(document.createTextNode(t(state.tab === 'albums' ? 'backAlbums' : 'back'))); back.addEventListener('click', () => navigate(`#/${state.tab}`)); section.append(back, thumb(f, true));
  const heading = el('div', 'detail-heading'), h2 = el('h2', '', ui.city(p)); h2.id = 'detail-title'; h2.tabIndex = -1;
  heading.append(h2); if (language === 'zh' && p.nameEn) heading.append(el('div', 'english', p.nameEn)); section.append(heading);
  section.append(el('p', 'detail-location', ui.location(p)));
  const visits = detailSection(t(p.visits.length > 1 ? 'repeatVisits' : 'visits'), 'calendar');
  const months = el('div', 'month-chips');
  if (p.visits.length) for (const v of p.visits) months.append(el('span', 'month-chip', ui.month(v.when)));
  else { months.append(el('span', `badge ${p.category}`, ui.category(p.category))); visits.append(el('p', 'subtle-copy', t('noMonth'))); }
  visits.append(months); section.append(visits);
  if (p.sourceInput?.city && p.sourceInput.city !== p.name) section.append(el('p', 'subtle-copy', t('representative', { alias: ui.alias(p), city: ui.city(p) })));
  if (p.note) section.append(el('p', 'subtle-copy', p.note));
  section.append(renderAlbum(f));
  const links = [{ link: p.link, label: t('story') }, ...p.visits.map(v => ({ link: v.link, label: t('visitStory', { month: ui.month(v.when) }) }))];
  for (const item of links) { const href = safeAssetURL(item.link, document.baseURI); if (href) { const a = el('a', 'story-link', item.label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; section.append(a); } }
  return section;
}

function updatePhotoFeatures(updated) {
  features = updated;
  if (state.tab === 'albums' && !state.selected) albumView.render();
  if (viewedPhoto) {
    const city = features.find(feature => feature.id === viewedPhoto.city.id);
    const photo = city && photoEntries(city.properties).find(entry => entry.src === viewedPhoto.photo.src && entry.when === viewedPhoto.photo.when);
    if (photo) $('#full-photo').src = photoUploader.previewURL(photo.src) || safeAssetURL(photo.src, document.baseURI);
    else $('#photo-viewer').close();
  }
  document.querySelectorAll('[data-cover-city]').forEach(cover => {
    const city = features.find(feature => feature.id === cover.dataset.coverCity);
    if (!city) return;
    const photo = photoEntries(city.properties).find(entry => safeAssetURL(entry.src, document.baseURI));
    const src = photo ? photoUploader.previewURL(photo.src) || safeAssetURL(photo.src, document.baseURI) : null;
    if ((cover.querySelector('img')?.getAttribute('src') || null) !== src) cover.replaceWith(thumb(city, cover.classList.contains('detail-cover')));
  });
  const selected = features.find(feature => feature.id === state.selected), previous = $('.travel-album');
  if (!selected || !previous) return;
  const scroll = $('#content').scrollTop, active = document.activeElement;
  const restoreFocus = previous.contains(active), label = active.getAttribute('aria-label');
  const album = renderAlbum(selected); previous.replaceWith(album); $('#content').scrollTop = scroll;
  if (restoreFocus) ([...album.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label) || album.querySelector('.album-add'))?.focus({ preventScroll: true });
}

function renderAlbum(f) {
  const p = f.properties, photos = detailSection(t('album'), 'photo'); photos.classList.add('travel-album');
  const albumHeading = el('div', 'album-heading');
  albumHeading.append(photos.firstElementChild);
  const entries = photoEntries(p).filter(photo => safeAssetURL(photo.src, document.baseURI));
  const addPhotos = el('button', 'album-add', t(entries.length ? 'uploadManage' : 'uploadAdd'));
  addPhotos.type = 'button';
  addPhotos.addEventListener('click', () => photoUploader.open(f, addPhotos, entries.length ? 'manage' : 'add'));
  albumHeading.append(addPhotos); photos.append(albumHeading, photoUploader.syncStatusElement(f.id));
  if (!entries.length) {
    const empty = el('div', 'empty-photo'); empty.innerHTML = icon('photo'); empty.append(el('span', '', t('noPhotos'))); photos.append(empty);
  } else {
    const grid = el('div', 'photo-grid');
    entries.forEach((photo, i) => {
      const button = el('button', 'photo-tile'), img = el('img'); button.setAttribute('aria-label', t('openPhoto', { city: ui.city(p), number: i + 1 }));
      img.src = photoUploader.previewURL(photo.src) || safeAssetURL(photo.src, document.baseURI); img.alt = photo.caption || t('photoAlt', { city: ui.city(p) }); img.loading = 'lazy'; button.append(img);
      img.addEventListener('error', () => { button.replaceChildren(el('span', 'subtle-copy', t('photoError'))); button.disabled = true; });
      button.addEventListener('click', () => showPhoto(photo, f, button));
      grid.append(button);
    }); photos.append(grid);
  }
  return photos;
}

function showPhoto(photo, city, opener) {
  viewedPhoto = { photo, city, opener };
  $('#full-photo').src = photoUploader.previewURL(photo.src) || safeAssetURL(photo.src, document.baseURI);
  $('#full-photo').alt = photo.caption || t('photoAlt', { city: ui.city(city.properties) });
  $('#photo-caption').textContent = [ui.city(city.properties), photo.when ? ui.month(photo.when) : t('undated'), photo.caption].filter(Boolean).join(' · ');
  $('#photo-viewer').showModal();
}

function renderTimeline() {
  const container = el('div', 'timeline');
  container.append(el('p', 'timeline-note', t('timelineNote')));
  const groups = timelineGroups(visible, state.year);
  if (!groups.length) { container.append(el('p', 'subtle-copy', t('noTimeline'))); return container; }
  for (const [month, list] of groups) {
    const group = el('section', 'timeline-group'); group.append(el('h2', '', ui.month(month)));
    for (const f of list) {
      const button = el('button', 'timeline-place'), label = el('span', '', ui.city(f.properties)); label.append(el('small', '', ui.country(f.properties))); button.append(label, el('span', '', '↗'));
      button.addEventListener('click', () => selectCity(f)); group.append(button);
    } container.append(group);
  } return container;
}

function renderStats() {
  const container = el('div', 'stats'), hero = el('div', 'stats-hero');
  const countries = [...new Set(visible.map(f => f.properties.countryCode))];
  for (const [number, label] of [[visible.length, t('cityUnit')], [countries.length, t('countryUnit')]]) {
    const stat = el('div'); stat.append(el('strong', '', number), el('span', '', label)); hero.append(stat);
  } container.append(hero);
  const months = timelineGroups(visible, state.year).map(([m]) => m);
  container.append(el('p', 'stats-range', months.length ? `${ui.month(months.at(-1))} — ${ui.month(months[0])} · ${t('recordedMonths')}` : t('undated')));
  const section = detailSection(t('distribution'), 'globe');
  countries.sort((a, b) => visible.filter(f => f.properties.countryCode === b).length - visible.filter(f => f.properties.countryCode === a).length).forEach(code => {
    const list = visible.filter(f => f.properties.countryCode === code);
    const button = el('button', 'stats-country');
    const label = el('span', 'label'); label.append(el('span', '', ui.country(list[0].properties)), el('span', '', t('cityCount', { count: list.length })));
    const track = el('div', 'bar-track'), bar = el('div', 'bar-fill'); bar.style.width = `${list.length / Math.max(1, visible.length) * 100}%`; track.append(bar); button.append(label, track);
    button.addEventListener('click', () => { state.country = code; $('#country').value = code; state.tab = 'places'; navigate('#/places'); fitPlaces(filterPlaces(features, state)); }); section.append(button);
  }); container.append(section);
  const statuses = el('div', 'status-stats'); for (const category of ['visited', 'residence', 'frequent']) { const n = visible.filter(f => f.properties.category === category).length; if (n) statuses.append(el('span', `badge ${category}`, `${ui.category(category)} ${n}`)); } container.append(statuses);
  container.append(el('p', 'subtle-copy', t('statsNote')));
  return container;
}

function render() {
  visible = filterPlaces(features, state);
  const selected = features.find(f => f.id === state.selected);
  const albumsOpen = state.tab === 'albums' && !selected;
  document.body.classList.toggle('albums-open', albumsOpen);
  $('#albums').hidden = !albumsOpen;
  $('#map').inert = albumsOpen; $('#map').setAttribute('aria-hidden', String(albumsOpen));
  $('#panel').hidden = albumsOpen; $('#panel').inert = albumsOpen || state.collapsed;
  $('#show-panel').hidden = albumsOpen || !state.collapsed;
  document.querySelectorAll('.map-controls, .map-help, .attribution').forEach(node => { node.hidden = albumsOpen; });
  document.body.classList.toggle('detail-open', !!selected);
  $('#filters').hidden = !!selected;
  $('#panel-title').textContent = t(selected ? 'detailTitle' : `${state.tab}Title`);
  $('#summary').textContent = `${ui.summary(features.length, new Set(features.map(f => f.properties.countryCode)).size)} · ${t('summarySuffix')}`;
  $('#atlas-summary').textContent = ui.summary(features.length, new Set(features.map(f => f.properties.countryCode)).size);
  document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === state.tab && !selected && (albumsOpen || !state.collapsed); button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  if (albumsOpen) { albumView.render(); popup?.remove(); return; }
  $('#clear-filters').hidden = state.country === 'all' && state.year === 'all' && !state.query;
  $('#result-count').textContent = selected ? `${ui.country(selected.properties)} · ${ui.category(selected.properties.category)}` : t('results', { shown: visible.length, total: features.length });
  $('#fit-results').textContent = t(selected ? 'locate' : 'fit');
  const content = $('#content'); content.replaceChildren();
  if (selected) content.append(renderDetail(selected));
  else if (!visible.length) content.append(emptyState());
  else if (state.tab === 'timeline') content.append(renderTimeline());
  else if (state.tab === 'stats') content.append(renderStats());
  else { const list = el('div', 'city-list'); for (const f of visible) list.append(renderCard(f)); content.append(list); }
  content.scrollTop = 0; popup?.remove(); renderMarkers();
}

function tooltip(f, coordinates = f.geometry.coordinates) {
  const p = f.properties, content = el('div'); content.append(el('div', 'tooltip-title', ui.city(p)), el('div', 'tooltip-country', ui.location(p)), el('div', 'tooltip-dates', ui.visits(p)));
  popup.setLngLat(toDisplayCoordinates(coordinates)).setDOMContent(content).addTo(map);
}
function renderMarkers() {
  if (!mapReady) return;
  const zoom = map.getZoom();
  const keys = new Set();
  // Every city keeps its actual coordinates. Nearby dots may overlap at world
  // scale; zooming in separates them without aggregation or visual displacement.
  for (const f of visible) {
    const key = f.id; keys.add(key);
    let record = markerCache.get(key);
    if (!record) {
      const button = el('button', 'map-pin');
      button.dataset.cityId = f.id;
      button.append(el('span', 'pin-dot'));
      button.addEventListener('click', e => { e.stopPropagation(); selectCity(f); });
      button.addEventListener('mouseenter', () => tooltip(f)); button.addEventListener('mouseleave', () => popup.remove());
      button.addEventListener('focus', () => tooltip(f)); button.addEventListener('blur', () => popup.remove());
      const marker = new Marker({ element: button, anchor: 'center' }).setLngLat(toDisplayCoordinates(f.geometry.coordinates)).addTo(map);
      record = { marker, button }; markerCache.set(key, record);
    }
    record.button.setAttribute('aria-label', `${ui.city(f.properties)}, ${ui.visits(f.properties)}`);
    record.button.classList.toggle('is-selected', f.id === state.selected);
  }
  for (const [key, record] of markerCache) if (!keys.has(key)) { record.marker.remove(); markerCache.delete(key); }
  $('#zoom-in').disabled = zoom >= 9; $('#zoom-out').disabled = zoom <= -1.5;
  $('#zoom-in').title = t('zoomLevel', { level: zoom.toFixed(1) });
}

async function init() {
  if (location.protocol === 'file:') throw new Error(t('fileError'));
  const load = async url => { const response = await fetch(url, url === './data/places.geojson' ? { cache: 'no-store' } : {}); if (!response.ok) throw new Error(`Unable to load ${url}`); return response.json(); };
  const [data, basemap, miniature] = await Promise.all([load('./data/places.geojson'), load('./data/basemaps/world-50m.geojson'), load('./data/basemaps/world-110m.geojson')]);
  features = data.features; world = projectCountries(basemap);
  // D3 uses clockwise outer rings, whereas source GeoJSON uses the opposite winding.
  miniatureWorld = structuredClone(miniature);
  for (const f of miniatureWorld.features) {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const polygon of polygons) { if (d3.geoArea({ type: 'Polygon', coordinates: [polygon[0]] }) > 2 * Math.PI) polygon.forEach(ring => ring.reverse()); }
  }
  renderFilterOptions();
  setWorkerUrl(new URL('../vendor/maplibre/maplibre-gl-worker.mjs', import.meta.url).href);
  map = new AtlasMap({ container: 'map', center: [22, 24], zoom: 1.5, minZoom: -1.5, maxZoom: 9, dragRotate: false, pitchWithRotate: false, renderWorldCopies: false, attributionControl: false,
    // Allow ocean margins around a single world so the sidebar cannot force
    // the automatic world-size constraint to hide the westernmost city.
    transformConstrain: (center, zoom) => ({ center: new LngLat(Math.max(-220, Math.min(220, center.lng)), Math.max(-80, Math.min(80, center.lat))), zoom: Math.max(-1.5, Math.min(9, zoom)) }),
    canvasContextAttributes: { antialias: true }, style: {
    version: 8, projection: { type: 'mercator' },
    sources: { countries: { type: 'geojson', data: world } },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#232629' } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#414145' } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#252629', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, .7, 6, 1] } },
    ],
  } });
  map.touchZoomRotate.disableRotation();
  popup = new Popup({ closeButton: false, closeOnClick: false, offset: 13, maxWidth: '260px', focusAfterOpen: false });
  map.on('load', () => {
    mapReady = true; lastError = null; setTheme(theme); readRoute();
    if (!state.selected) fitPlaces(features, true);
    $('#loading').hidden = true;
  });
  map.on('move', () => { popup.remove(); if (!frame) frame = requestAnimationFrame(() => { frame = null; renderMarkers(); }); });
  map.on('movestart', () => $('#map').setAttribute('aria-busy', 'true'));
  map.on('moveend', () => { $('#map').setAttribute('aria-busy', 'false'); renderMarkers(); });
  map.on('error', event => { console.error(event.error); if (!mapReady) showError('mapError'); });
  map.getCanvas().setAttribute('aria-label', t('canvas'));
  new ResizeObserver(() => {
    if (!mapReady) return;
    map.resize();
    fitPlaces(state.selected ? features.filter(f => f.id === state.selected) : visible, state.worldView);
  }).observe($('#map'));
  render();
}

function showError(key) {
  lastError = key;
  const loading = $('#loading'); loading.hidden = false; loading.classList.add('error'); loading.replaceChildren(el('strong', '', t('errorTitle')), el('span', '', t(key)));
  const retry = el('button', '', t('retry')); retry.addEventListener('click', () => location.reload()); loading.append(retry);
}
$('#language').addEventListener('click', () => setLanguage(language === 'en' ? 'zh' : 'en'));
$('#theme').addEventListener('click', () => setTheme(theme === 'light' ? 'dark' : 'light'));
$('.skip-link').addEventListener('click', event => { event.preventDefault(); setCollapsed(false); navigate('#/places'); requestAnimationFrame(() => $('#panel').focus()); });
$('#home').addEventListener('click', () => { clearFilters(); setCollapsed(true); state.tab = 'places'; navigate('#/places'); fitPlaces(features, true); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { setCollapsed(false); navigate(`#/${button.dataset.view}`); }));
$('#collapse').addEventListener('click', () => { setCollapsed(true); render(); if (!state.selected) fitPlaces(visible, state.worldView); $('#show-panel').focus(); });
$('#show-panel').addEventListener('click', () => { setCollapsed(false); render(); fitPlaces(state.selected ? features.filter(f => f.id === state.selected) : visible, state.worldView); $('#collapse').focus(); });
$('#country').addEventListener('change', e => { state.country = e.target.value; render(); fitPlaces(visible); });
$('#year').addEventListener('change', e => { state.year = e.target.value; render(); fitPlaces(visible); });
$('#search').addEventListener('input', e => { state.query = e.target.value; render(); });
$('#search').addEventListener('keydown', e => { if (e.key === 'Enter') fitPlaces(visible); });
$('#clear-filters').addEventListener('click', () => { clearFilters(); render(); fitPlaces(features, true); });
$('#fit-results').addEventListener('click', () => fitPlaces(state.selected ? features.filter(f => f.id === state.selected) : visible));
$('#zoom-in').addEventListener('click', () => map?.zoomIn({ duration: motion() / 3 }));
$('#zoom-out').addEventListener('click', () => map?.zoomOut({ duration: motion() / 3 }));
$('#reset-view').addEventListener('click', () => fitPlaces(features, true));
$('#close-photo').addEventListener('click', () => $('#photo-viewer').close());
$('#photo-viewer').addEventListener('click', e => { if (e.target === $('#photo-viewer')) $('#photo-viewer').close(); });
$('#photo-viewer').addEventListener('close', () => {
  const opener = viewedPhoto?.opener; viewedPhoto = null;
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  else {
    const replacement = opener?.dataset.photoKey && [...document.querySelectorAll('#albums [data-photo-key]')].find(node => node.dataset.photoKey === opener.dataset.photoKey);
    (replacement || (state.tab === 'albums' && !state.selected ? $('#albums-title') : $('#detail-title')))?.focus({ preventScroll: true });
  }
});
window.addEventListener('hashchange', () => { if (features.length) readRoute(); });
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return;
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#photo-viewer').open) { e.preventDefault(); setCollapsed(false); navigate('#/places'); requestAnimationFrame(() => $('#search').focus()); }
  if (e.key === 'Escape' && !$('#photo-viewer').open) { popup?.remove(); if (state.selected) navigate(`#/${state.tab}`); }
});
init().catch(error => { console.error(error); showError(location.protocol === 'file:' ? 'fileError' : 'loadError'); });
