export const categories = { visited: '到访', residence: '常住', frequent: '常去' };
export const monthLabel = value => `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`;
export const visitLabel = p => p.visits.length ? p.visits.map(v => monthLabel(v.when)).join(' · ') : `${categories[p.category]} · 未记录具体月份`;
export const latestMonth = f => f.properties.visits.map(v => v.when).sort().at(-1) || '';

export function filterPlaces(features, { query = '', country = 'all', year = 'all' } = {}) {
  const text = query.trim().toLocaleLowerCase();
  return features.filter(f => {
    const p = f.properties;
    return (country === 'all' || p.countryCode === country) &&
      (year === 'all' || p.visits.some(v => v.when.startsWith(`${year}-`))) &&
      (!text || [p.name, p.nameEn, p.country, p.region, p.sourceInput?.city].some(s => s?.toLocaleLowerCase().includes(text)));
  }).sort((a, b) => latestMonth(b).localeCompare(latestMonth(a)) || a.properties.name.localeCompare(b.properties.name, 'zh-CN'));
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
