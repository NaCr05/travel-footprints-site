import { createI18n } from './i18n.js';
const english = createI18n('en');
export const latestMonth = f => f.properties.visits.map(v => v.when).sort().at(-1) || '';

export function filterPlaces(features, { query = '', country = 'all', year = 'all', language = 'en' } = {}) {
  const text = query.trim().toLocaleLowerCase();
  const display = createI18n(language);
  return features.filter(f => {
    const p = f.properties;
    return (country === 'all' || p.countryCode === country) &&
      (year === 'all' || p.visits.some(v => v.when.startsWith(`${year}-`))) &&
      (!text || [p.name, p.nameEn, p.country, p.region, p.sourceInput?.city, english.country(p), english.region(p), english.alias(p)].some(s => s?.toLocaleLowerCase().includes(text)));
  }).sort((a, b) => latestMonth(b).localeCompare(latestMonth(a)) || display.city(a.properties).localeCompare(display.city(b.properties), language === 'zh' ? 'zh-CN' : 'en'));
}

export function timelineGroups(features, year = 'all') {
  const groups = new Map();
  for (const f of features) for (const visit of f.properties.visits) {
    if (year !== 'all' && !visit.when.startsWith(`${year}-`)) continue;
    if (!groups.has(visit.when)) groups.set(visit.when, []);
    groups.get(visit.when).push(f);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
}

export function safeAssetURL(value, base) {
  if (typeof value !== 'string' || !value.trim() || /^[\s]*(?:data|javascript|vbscript|file):/i.test(value) || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function photoEntries(p) {
  const normalize = (photo, when = '') => typeof photo === 'string' ? { src: photo, caption: '', when } : { ...photo, when };
  return [...p.photos.map(photo => normalize(photo)), ...p.visits.flatMap(v => (v.photos || []).map(photo => normalize(photo, v.when)))];
}
