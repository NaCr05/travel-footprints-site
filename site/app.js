import { Map as AtlasMap, Marker, Popup, LngLat, setWorkerUrl } from '../vendor/maplibre/maplibre-gl.mjs';
import { categories, monthLabel, visitLabel, filterPlaces, timelineGroups, safeAssetURL, photoEntries } from './model.js';
import { toDisplayCoordinates, projectCountries } from './projection.js';

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
const state = { tab: 'places', query: '', country: 'all', year: 'all', selected: null, collapsed: true, worldView: true };
let features = [], visible = [], world, miniatureWorld, map, popup, mapReady = false, frame;
const markerCache = new globalThis.Map();
let theme = 'dark';
try { theme = localStorage.getItem('footprints-theme-v2') === 'light' ? 'light' : 'dark'; } catch { /* Storage can be disabled. */ }

$('#search-icon').innerHTML = icon('search');
$('#collapse').innerHTML = `${icon('back')}<span>收起</span>`;
$('#reset-view').innerHTML = icon('globe');
$('#clear-filters').innerHTML = icon('cross');

function setTheme(next) {
  theme = next;
  document.body.dataset.theme = theme;
  $('#theme').innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
  $('#theme').setAttribute('aria-label', `切换到${theme === 'light' ? '深' : '浅'}色模式`);
  try { localStorage.setItem('footprints-theme-v2', theme); } catch { /* Optional preference only. */ }
  if (mapReady) {
    map.setPaintProperty('ocean', 'background-color', theme === 'light' ? '#edf0f1' : '#232629');
    map.setPaintProperty('land', 'fill-color', theme === 'light' ? '#d4d8db' : '#414145');
    map.setPaintProperty('borders', 'line-color', theme === 'light' ? '#b9c0c5' : '#252629');
  }
}
setTheme(theme);

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
  if (!selected) state.tab = ['places', 'timeline', 'stats'].includes(parts[0]) ? parts[0] : 'places';
  if (selected && !filterPlaces(features, state).some(f => f.id === selected.id)) clearFilters();
  render();
  if (selected) {
    fitPlaces([selected]);
    $('#detail-title').focus({ preventScroll: true });
  }
}

function thumb(f, large = false) {
  const p = f.properties;
  const cover = el('div', `city-cover${large ? ' detail-cover' : ''}`);
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
    const img = el('img'); img.src = safeAssetURL(firstPhoto.src, document.baseURI); img.alt = firstPhoto.caption || `${p.name}的照片`; img.loading = 'lazy';
    svg.setAttribute('hidden', ''); cover.append(img); img.addEventListener('error', () => { img.remove(); svg.removeAttribute('hidden'); });
  }
  const tag = el('span', 'country-tag', p.country); cover.append(tag);
  const [lon, lat] = f.geometry.coordinates;
  cover.append(el('span', 'cover-coordinates', `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`));
  return cover;
}

function renderCard(f) {
  const p = f.properties;
  const button = el('button', 'city-card');
  button.dataset.cityId = f.id; button.setAttribute('aria-label', `查看${p.name}，${visitLabel(p)}`);
  const copy = el('div', 'card-copy'), title = el('div', 'card-title');
  title.append(el('h2', '', p.name), el('span', 'english', p.nameEn), el('span', 'card-arrow', '↗'));
  const date = el('div', 'card-date'); date.innerHTML = icon('calendar');
  if (p.visits.length) date.append(el('span', '', p.visits.map(v => v.when.replace('-', '.')).join(' / ')));
  else date.append(el('span', `badge ${p.category}`, categories[p.category]));
  copy.append(title, date); button.append(copy); button.addEventListener('click', () => selectCity(f));
  return button;
}

function emptyState() {
  const empty = el('div', 'empty-state'); empty.innerHTML = icon('search');
  empty.append(el('h2', '', '还没有找到这座城市'), el('p', '', '试试其他城市名，或放宽国家和年份。'));
  const reset = el('button', '', '清除筛选'); reset.addEventListener('click', () => { clearFilters(); render(); fitPlaces(visible); }); empty.append(reset);
  return empty;
}
function detailSection(title, iconName) {
  const section = el('section', 'detail-section'), heading = el('h3'); heading.innerHTML = icon(iconName); heading.append(document.createTextNode(title)); section.append(heading); return section;
}
function renderDetail(f) {
  const p = f.properties, section = el('div', 'city-detail');
  const back = el('button', 'detail-back'); back.innerHTML = icon('back'); back.append(document.createTextNode('返回列表')); back.addEventListener('click', () => navigate(`#/${state.tab}`)); section.append(back, thumb(f, true));
  const heading = el('div', 'detail-heading'), h2 = el('h2', '', p.name); h2.id = 'detail-title'; h2.tabIndex = -1;
  heading.append(h2, el('div', 'english', p.nameEn)); section.append(heading);
  section.append(el('p', 'detail-location', [p.country, p.region].filter(Boolean).join(' / ')));
  const visits = detailSection(p.visits.length > 1 ? '到访记录 · 再次相见' : '到访记录', 'calendar');
  const months = el('div', 'month-chips');
  if (p.visits.length) for (const v of p.visits) months.append(el('span', 'month-chip', monthLabel(v.when)));
  else { months.append(el('span', `badge ${p.category}`, categories[p.category])); visits.append(el('p', 'subtle-copy', '未记录具体到访月份。')); }
  visits.append(months); section.append(visits);
  if (p.sourceInput.city !== p.name) section.append(el('p', 'subtle-copy', `清单中的「${p.sourceInput.city}」，在地图上以${p.name}为代表点。`));
  if (p.note) section.append(el('p', 'subtle-copy', p.note));
  const photos = detailSection('旅途相册', 'photo');
  const entries = photoEntries(p).filter(photo => safeAssetURL(photo.src, document.baseURI));
  if (!entries.length) {
    const empty = el('div', 'empty-photo'); empty.innerHTML = icon('photo'); empty.append(el('span', '', '还没有添加照片。\n把这段记忆留给下一次补全。')); photos.append(empty);
  } else {
    const grid = el('div', 'photo-grid');
    entries.forEach((photo, i) => {
      const button = el('button', 'photo-tile'), img = el('img'); button.setAttribute('aria-label', `打开${p.name}的第 ${i + 1} 张照片`);
      img.src = safeAssetURL(photo.src, document.baseURI); img.alt = photo.caption || `${p.name}的照片`; img.loading = 'lazy'; button.append(img);
      img.addEventListener('error', () => { button.replaceChildren(el('span', 'subtle-copy', '照片暂时无法加载')); button.disabled = true; });
      button.addEventListener('click', () => { $('#full-photo').src = img.src; $('#full-photo').alt = img.alt; $('#photo-caption').textContent = [photo.caption || p.name, photo.when ? monthLabel(photo.when) : ''].filter(Boolean).join(' · '); $('#photo-viewer').showModal(); });
      grid.append(button);
    }); photos.append(grid);
  }
  section.append(photos);
  const links = [{ link: p.link, label: '阅读城市故事 ↗' }, ...p.visits.map(v => ({ link: v.link, label: `${monthLabel(v.when)}的旅行记录 ↗` }))];
  for (const item of links) { const href = safeAssetURL(item.link, document.baseURI); if (href) { const a = el('a', 'story-link', item.label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; section.append(a); } }
  return section;
}

function renderTimeline() {
  const container = el('div', 'timeline');
  container.append(el('p', 'timeline-note', '按记录的月份回望。常住、常去的城市尚未记录具体月份，不排列进时间线。'));
  const groups = timelineGroups(visible, state.year);
  if (!groups.length) { container.append(el('p', 'subtle-copy', '当前筛选下暂无带月份的记录。')); return container; }
  for (const [month, list] of groups) {
    const group = el('section', 'timeline-group'); group.append(el('h2', '', monthLabel(month)));
    for (const f of list) {
      const button = el('button', 'timeline-place'), label = el('span', '', f.properties.name); label.append(el('small', '', f.properties.country)); button.append(label, el('span', '', '↗'));
      button.addEventListener('click', () => selectCity(f)); group.append(button);
    } container.append(group);
  } return container;
}

function renderStats() {
  const container = el('div', 'stats'), hero = el('div', 'stats-hero');
  const countries = [...new Set(visible.map(f => f.properties.countryCode))];
  for (const [number, label] of [[visible.length, '座城市与城镇'], [countries.length, '个国家']]) {
    const stat = el('div'); stat.append(el('strong', '', number), el('span', '', label)); hero.append(stat);
  } container.append(hero);
  const months = timelineGroups(visible, state.year).map(([m]) => m);
  container.append(el('p', 'stats-range', months.length ? `${months.at(-1).replace('-', '.')} — ${months[0].replace('-', '.')} · 已记录的月份` : '尚未记录具体月份'));
  const section = detailSection('足迹分布', 'globe');
  countries.sort((a, b) => visible.filter(f => f.properties.countryCode === b).length - visible.filter(f => f.properties.countryCode === a).length).forEach(code => {
    const list = visible.filter(f => f.properties.countryCode === code);
    const button = el('button', 'stats-country');
    const label = el('span', 'label'); label.append(el('span', '', list[0].properties.country), el('span', '', `${list.length} 座城市`));
    const track = el('div', 'bar-track'), bar = el('div', 'bar-fill'); bar.style.width = `${list.length / Math.max(1, visible.length) * 100}%`; track.append(bar); button.append(label, track);
    button.addEventListener('click', () => { state.country = code; $('#country').value = code; state.tab = 'places'; navigate('#/places'); fitPlaces(filterPlaces(features, state)); }); section.append(button);
  }); container.append(section);
  const statuses = el('div', 'status-stats'); for (const [category, label] of Object.entries(categories)) { const n = visible.filter(f => f.properties.category === category).length; if (n) statuses.append(el('span', `badge ${category}`, `${label} ${n}`)); } container.append(statuses);
  container.append(el('p', 'subtle-copy', '同一城市多次到访只计一座城市。月份记录不等同于旅行次数。'));
  return container;
}

function render() {
  visible = filterPlaces(features, state);
  const selected = features.find(f => f.id === state.selected);
  document.body.classList.toggle('detail-open', !!selected);
  $('#filters').hidden = !!selected;
  $('#panel-title').textContent = selected ? '城市记忆' : ({ places: '走过的地方', timeline: '沿着时间回望', stats: '世界的一小部分' })[state.tab];
  $('#summary').textContent = `${features.length} 座城市 · ${new Set(features.map(f => f.properties.countryCode)).size} 个国家 · 一张慢慢填满的地图`;
  $('#atlas-summary').textContent = `${features.length} 座城市 · ${new Set(features.map(f => f.properties.countryCode)).size} 个国家`;
  document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === state.tab && !selected && !state.collapsed; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#clear-filters').hidden = state.country === 'all' && state.year === 'all' && !state.query;
  $('#result-count').textContent = selected ? `${selected.properties.country} · ${categories[selected.properties.category]}` : `${visible.length} / ${features.length} 座城市`;
  $('#fit-results').textContent = selected ? '定位这座城市 ↗' : '在地图上查看 ↗';
  const content = $('#content'); content.replaceChildren();
  if (selected) content.append(renderDetail(selected));
  else if (!visible.length) content.append(emptyState());
  else if (state.tab === 'timeline') content.append(renderTimeline());
  else if (state.tab === 'stats') content.append(renderStats());
  else { const list = el('div', 'city-list'); for (const f of visible) list.append(renderCard(f)); content.append(list); }
  content.scrollTop = 0; popup?.remove(); renderMarkers();
}

function tooltip(f, coordinates = f.geometry.coordinates) {
  const p = f.properties, content = el('div'); content.append(el('div', 'tooltip-title', p.name), el('div', 'tooltip-country', [p.country, p.region].filter(Boolean).join(' / ')), el('div', 'tooltip-dates', visitLabel(p)));
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
      button.dataset.cityId = f.id; button.setAttribute('aria-label', `${f.properties.name}，${visitLabel(f.properties)}`);
      button.append(el('span', 'pin-dot'));
      button.addEventListener('click', e => { e.stopPropagation(); selectCity(f); });
      button.addEventListener('mouseenter', () => tooltip(f)); button.addEventListener('mouseleave', () => popup.remove());
      button.addEventListener('focus', () => tooltip(f)); button.addEventListener('blur', () => popup.remove());
      const marker = new Marker({ element: button, anchor: 'center' }).setLngLat(toDisplayCoordinates(f.geometry.coordinates)).addTo(map);
      record = { marker, button }; markerCache.set(key, record);
    }
    record.button.classList.toggle('is-selected', f.id === state.selected);
  }
  for (const [key, record] of markerCache) if (!keys.has(key)) { record.marker.remove(); markerCache.delete(key); }
  $('#zoom-in').disabled = zoom >= 9; $('#zoom-out').disabled = zoom <= -1.5;
  $('#zoom-in').title = `放大 · 当前级别 ${zoom.toFixed(1)}`;
}

async function init() {
  if (location.protocol === 'file:') throw new Error('请通过本地预览服务打开地图，双击 HTML 文件无法加载城市数据。项目说明中有启动方式。');
  const load = async url => { const response = await fetch(url); if (!response.ok) throw new Error(`无法读取 ${url}`); return response.json(); };
  const [data, basemap, miniature] = await Promise.all([load('./data/places.geojson'), load('./data/basemaps/world-50m.geojson'), load('./data/basemaps/world-110m.geojson')]);
  features = data.features; world = projectCountries(basemap);
  // D3 uses clockwise outer rings, whereas source GeoJSON uses the opposite winding.
  miniatureWorld = structuredClone(miniature);
  for (const f of miniatureWorld.features) {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const polygon of polygons) { if (d3.geoArea({ type: 'Polygon', coordinates: [polygon[0]] }) > 2 * Math.PI) polygon.forEach(ring => ring.reverse()); }
  }
  const countries = [...new globalThis.Map(features.map(f => [f.properties.countryCode, f.properties.country]))];
  countries.forEach(([code, name]) => { const option = el('option', '', name); option.value = code; $('#country').append(option); });
  const years = [...new Set(features.flatMap(f => f.properties.visits.map(v => v.when.slice(0, 4))))].sort().reverse();
  years.forEach(year => { const option = el('option', '', `${year} 年`); option.value = year; $('#year').append(option); });
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
    mapReady = true; setTheme(theme); readRoute();
    if (!state.selected) fitPlaces(features, true);
    $('#loading').hidden = true;
  });
  map.on('move', () => { popup.remove(); if (!frame) frame = requestAnimationFrame(() => { frame = null; renderMarkers(); }); });
  map.on('movestart', () => $('#map').setAttribute('aria-busy', 'true'));
  map.on('moveend', () => { $('#map').setAttribute('aria-busy', 'false'); renderMarkers(); });
  map.on('error', event => { console.error(event.error); if (!mapReady) showError('地图加载遇到问题。请刷新页面；如果仍无法显示，请检查浏览器是否支持 WebGL。'); });
  map.getCanvas().setAttribute('aria-label', '世界地图，可用方向键移动、加减键缩放');
  new ResizeObserver(() => {
    if (!mapReady) return;
    map.resize();
    fitPlaces(state.selected ? features.filter(f => f.id === state.selected) : visible, state.worldView);
  }).observe($('#map'));
  render();
}

function showError(message) {
  const loading = $('#loading'); loading.hidden = false; loading.classList.add('error'); loading.replaceChildren(el('strong', '', '地图暂时没有展开'), el('span', '', message));
  const retry = el('button', '', '重新加载'); retry.addEventListener('click', () => location.reload()); loading.append(retry);
}
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
window.addEventListener('hashchange', () => { if (features.length) readRoute(); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#photo-viewer').open) { e.preventDefault(); setCollapsed(false); navigate('#/places'); requestAnimationFrame(() => $('#search').focus()); }
  if (e.key === 'Escape' && !$('#photo-viewer').open) { popup?.remove(); if (state.selected) navigate(`#/${state.tab}`); }
});
init().catch(error => { console.error(error); showError(error.message); });
