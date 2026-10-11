import { libraryPhotos, groupLibraryPhotos } from './photo-library.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export function createAlbumView({ root, getFeatures, getUI, previewURL, openCity, openPhoto }) {
  const state = { group: 'city', city: 'all', month: 'all' };
  const header = el('header', 'library-header'), heading = el('div');
  const title = el('h2'); title.id = 'albums-title'; title.tabIndex = -1;
  const summary = el('p', 'library-summary'); summary.setAttribute('role', 'status');
  heading.append(title, summary); header.append(heading);
  const controls = el('div', 'library-controls'), grouping = el('div', 'library-grouping');
  grouping.setAttribute('role', 'group');
  const groupButtons = ['city', 'month'].map(value => {
    const button = el('button'); button.type = 'button';
    button.addEventListener('click', () => { state.group = value; render(true); });
    grouping.append(button); return button;
  });
  const filters = el('div', 'library-filters');
  const cityLabel = el('label'), monthLabel = el('label'), cityText = el('span'), monthText = el('span');
  const citySelect = el('select'), monthSelect = el('select');
  citySelect.id = 'album-city-filter'; monthSelect.id = 'album-month-filter';
  cityLabel.append(cityText, citySelect); monthLabel.append(monthText, monthSelect); filters.append(cityLabel, monthLabel);
  citySelect.addEventListener('change', () => { state.city = citySelect.value; render(true); });
  monthSelect.addEventListener('change', () => { state.month = monthSelect.value; render(true); });
  controls.append(grouping, filters); header.append(controls);
  const groupsRoot = el('div', 'library-groups');
  root.append(header, groupsRoot);

  function setOptions(select, items, value) {
    select.replaceChildren(...items.map(([key, label]) => {
      const option = el('option', '', label); option.value = key; return option;
    }));
    select.value = value;
  }

  function render(resetScroll = false) {
    const ui = getUI(), t = ui.t, scroll = root.scrollTop;
    const active = document.activeElement, focusKey = groupsRoot.contains(active) ? active.dataset.libraryFocus : null;
    const photos = libraryPhotos(getFeatures(), document.baseURI);
    const cities = [...new Map(photos.map(photo => [photo.city.id, photo.city])).values()]
      .sort((a, b) => ui.city(a.properties).localeCompare(ui.city(b.properties), ui.language === 'zh' ? 'zh-CN' : 'en'));
    const months = [...new Set(photos.map(photo => photo.when))].sort().reverse();
    // If the last photo of the selected city/month is removed, reveal the remaining collection.
    if (state.city !== 'all' && !cities.some(city => city.id === state.city)) state.city = 'all';
    if (state.month !== 'all' && !months.includes(state.month === 'undated' ? '' : state.month)) state.month = 'all';
    title.textContent = t('albumsTitle'); grouping.setAttribute('aria-label', t('albumGroupLabel'));
    groupButtons.forEach((button, index) => {
      button.textContent = t(index ? 'albumByMonth' : 'albumByCity');
      button.setAttribute('aria-pressed', String(state.group === (index ? 'month' : 'city')));
    });
    cityText.textContent = t('albumCityFilter'); monthText.textContent = t('albumMonthFilter');
    citySelect.setAttribute('aria-label', t('albumCityFilter')); monthSelect.setAttribute('aria-label', t('albumMonthFilter'));
    setOptions(citySelect, [['all', t('albumAllCities')], ...cities.map(city => [city.id, ui.city(city.properties)])], state.city);
    setOptions(monthSelect, [['all', t('albumAllMonths')], ...months.map(month => [month || 'undated', month ? ui.month(month) : t('undated')])], state.month);
    const groups = groupLibraryPhotos(photos, state, ui), count = groups.reduce((sum, group) => sum + group.photos.length, 0);
    const cityCount = new Set(groups.flatMap(group => group.photos.map(photo => photo.city.id))).size;
    summary.textContent = `${t('photoCount', { count })} · ${t('cityCount', { count: cityCount })}`;
    groupsRoot.className = `library-groups library-groups--${state.group}`;
    groupsRoot.replaceChildren();
    if (!groups.length) {
      const empty = el('div', 'library-empty');
      empty.append(el('h3', '', t(photos.length ? 'albumNoMatches' : 'albumEmptyTitle')), el('p', '', t(photos.length ? 'albumFilterHint' : 'albumEmptyHint')));
      if (photos.length) {
        const clear = el('button', 'library-text-button', t('clear'));
        clear.addEventListener('click', () => { state.city = 'all'; state.month = 'all'; render(true); citySelect.focus(); }); empty.append(clear);
      }
      groupsRoot.append(empty);
    }
    for (const group of groups) {
      const section = el('section', 'library-group'), groupHeading = el('div', 'library-group-heading'), h3 = el('h3');
      if (state.group === 'city') {
        const city = group.photos[0].city, button = el('button', 'library-city-link', ui.city(city.properties));
        button.dataset.libraryFocus = `city:${city.id}`; button.addEventListener('click', () => openCity(city)); h3.append(button);
        groupHeading.append(h3, el('span', 'library-group-meta', `${ui.country(city.properties)} · ${t('photoCount', { count: group.photos.length })}`));
      } else {
        h3.textContent = group.key ? ui.month(group.key) : t('undated');
        groupHeading.append(h3, el('span', 'library-group-meta', t('photoCount', { count: group.photos.length })));
      }
      section.append(groupHeading);
      const grid = el('div', 'library-photo-grid');
      group.photos.forEach((photo, index) => {
        const figure = el('figure', 'library-photo'), button = el('button', 'library-photo-button'), img = el('img');
        button.dataset.libraryFocus = photo.key; button.dataset.photoKey = photo.key;
        button.setAttribute('aria-label', t('albumOpenPhoto', { city: ui.city(photo.city.properties), month: photo.when ? ui.month(photo.when) : t('undated'), number: index + 1 }));
        img.src = previewURL(photo.src) || photo.url; img.alt = photo.caption || t('photoAlt', { city: ui.city(photo.city.properties) });
        img.loading = 'lazy'; img.decoding = 'async'; button.append(img);
        img.addEventListener('error', () => { button.replaceChildren(el('span', 'library-photo-error', t('photoError'))); button.disabled = true; });
        button.addEventListener('click', () => openPhoto(photo, photo.city, button));
        const caption = el('figcaption');
        if (state.group === 'month') {
          const cityLink = el('button', 'library-city-link', ui.city(photo.city.properties));
          cityLink.dataset.libraryFocus = `link:${photo.key}`; cityLink.addEventListener('click', () => openCity(photo.city)); caption.append(cityLink);
        } else caption.append(el('span', 'library-date', photo.when ? ui.month(photo.when) : t('undated')));
        if (photo.caption) caption.append(el('span', 'library-caption', photo.caption));
        figure.append(button, caption); grid.append(figure);
      });
      section.append(grid); groupsRoot.append(section);
    }
    root.scrollTop = resetScroll ? 0 : scroll;
    if (focusKey) ([...groupsRoot.querySelectorAll('[data-library-focus]')].find(node => node.dataset.libraryFocus === focusKey) || title).focus({ preventScroll: true });
  }
  return { render };
}
