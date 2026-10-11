// Display metadata is separate from personal wishes. Never mutate a saved
// record to translate it, and never infer a display language from an alias.
export function validateCityLocales(data) {
  if (data?.schemaVersion !== 1 || !data.cities || !data.regions) throw new Error('invalid_city_locales');
  for (const entries of [data.cities, data.regions]) {
    if (typeof entries !== 'object' || Array.isArray(entries)) throw new Error('invalid_city_locales');
    for (const pair of Object.values(entries)) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair[0] || pair.some(value => typeof value !== 'string' || value.length > 200)) throw new Error('invalid_city_locales');
    }
  }
  return data;
}

export function cityLabels(city, language, locales) {
  const names = locales?.cities[city.id] || [city.nameEn, city.nameZh];
  const region = locales?.regions[`${city.countryCode}:${city.region}`] || [city.region, ''];
  const chinese = language === 'zh';
  return {
    name: chinese ? names[1] || names[0] : names[0],
    country: new Intl.DisplayNames([language], { type: 'region' }).of(city.countryCode),
    region: chinese ? region[1] || region[0] : region[0],
    missingName: chinese && !names[1],
    missingRegion: chinese && !!region[0] && !region[1],
  };
}

export function formatCityLabels(city, ui, locales) {
  const labels = cityLabels(city, ui.language, locales);
  const annotate = (value, missing) => missing ? `${value}（${ui.t(locales ? 'wishNoChineseName' : 'wishNamesUnavailable')}）` : value;
  return {
    name: annotate(labels.name, labels.missingName),
    place: [labels.country, annotate(labels.region, labels.missingRegion)].filter(Boolean).join(' / '),
  };
}
