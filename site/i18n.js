import { uploadMessages } from './upload-i18n.js';
export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_STORAGE_KEY = 'footprints-language-v1';
export const resolveLanguage = value => value === 'zh' ? 'zh' : DEFAULT_LANGUAGE;

const plural = new Intl.PluralRules('en');
const englishCount = (count, one, other) => `${count} ${plural.select(count) === 'one' ? one : other}`;
const messages = {
  en: {
    ...uploadMessages.en,
    pageTitle: 'Travel Footprints · Places I’ve Visited', brand: 'Places I’ve Visited',
    description: 'A world map of places visited, the months spent there, and memories along the way.',
    atlas: 'Travel Footprints', skip: 'Skip to city list', map: 'Interactive travel map',
    loading: 'Unfolding the world map…', home: 'Back to all places', navigation: 'Main navigation',
    places: 'Cities', timeline: 'Timeline', stats: 'Overview', panel: 'Cities and travel records',
    placesTitle: 'Places visited', timelineTitle: 'Through the years', statsTitle: 'At a glance', detailTitle: 'City memories',
    subtitle: 'Every dot holds a memory.', summarySuffix: 'A map filled one memory at a time',
    collapse: 'Hide', collapseLabel: 'Hide sidebar', expand: 'Show sidebar', cityList: 'City list',
    search: 'Find a city…', searchLabel: 'Search cities, countries or regions', country: 'Country', year: 'Year visited',
    allCountries: 'All countries', allYears: 'All years', yearOption: ({ year }) => year, clear: 'Clear filters',
    fit: 'Show on map ↗', locate: 'Locate this city ↗', controls: 'Map controls',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', world: 'Back to world view',
    zoomLevel: ({ level }) => `Zoom in · Current level ${level}`,
    help: 'Drag · Zoom · Hover to explore', canvas: 'World map. Use arrow keys to move and plus or minus to zoom.',
    lightTheme: 'Switch to light mode', darkTheme: 'Switch to dark mode',
    language: 'Switch to Chinese / 切换到中文', photosLabel: 'City photos', closePhoto: 'Close photo',
    visited: 'Visited', residence: 'Lived in', frequent: 'Often visited', undated: 'Month not recorded',
    cityCount: ({ count }) => englishCount(count, 'city', 'cities'),
    countryCount: ({ count }) => englishCount(count, 'country', 'countries'),
    results: ({ shown, total }) => `${shown} / ${englishCount(total, 'city', 'cities')}`,
    viewCity: ({ city, visits }) => `View ${city}, ${visits}`,
    noResults: 'No matching cities', searchHint: 'Try another name, or broaden the country and year filters.',
    back: 'Back to list', visits: 'Visit history', repeatVisits: 'Visit history · Back again',
    noMonth: 'The month of this visit was not recorded.',
    representative: ({ alias, city }) => `${city} represents “${alias}” on the map.`,
    album: 'Travel album', noPhotos: 'No photos yet. A memory to add another day.',
    photoAlt: ({ city }) => `Photo of ${city}`, openPhoto: ({ city, number }) => `Open photo ${number} of ${city}`,
    photoError: 'This photo could not be loaded.', story: 'Read the city story ↗',
    visitStory: ({ month }) => `Travel notes · ${month} ↗`,
    timelineNote: 'A look back by month. Places lived in or visited often without a recorded month are not included.',
    noTimeline: 'No dated visits match these filters.', cityUnit: 'Cities and towns', countryUnit: 'Countries',
    recordedMonths: 'Recorded months', distribution: 'Places by country',
    statsNote: 'Each city is counted once, even with repeat visits. Month entries do not represent separate trips.',
    errorTitle: 'The map could not be loaded', retry: 'Reload',
    fileError: 'Open the map through the local preview server described in the README, rather than opening the HTML file directly.',
    loadError: 'The map data could not be loaded. Check your connection and reload the page.',
    mapError: 'Reload the page. If the map still does not appear, check whether your browser supports WebGL.',
  },
  zh: {
    ...uploadMessages.zh,
    pageTitle: '旅行足迹 · 走过的地方', brand: '走过的地方',
    description: '一张慢慢填满的世界地图。记录去过的城市、到访月份和旅途中的记忆。',
    atlas: '旅行足迹', skip: '跳到城市列表', map: '旅行足迹交互地图',
    loading: '正在展开世界地图…', home: '返回全部足迹', navigation: '主要导航',
    places: '城市', timeline: '时间线', stats: '概览', panel: '城市与旅行记录',
    placesTitle: '走过的地方', timelineTitle: '沿着时间回望', statsTitle: '世界的一小部分', detailTitle: '城市记忆',
    subtitle: '每一个点，都是一段记忆。', summarySuffix: '一张慢慢填满的地图',
    collapse: '收起', collapseLabel: '收起侧栏', expand: '展开侧栏', cityList: '城市列表',
    search: '找一座城市…', searchLabel: '搜索城市、国家或地区', country: '国家', year: '到访年份',
    allCountries: '所有国家', allYears: '所有年份', yearOption: ({ year }) => `${year} 年`, clear: '清除筛选',
    fit: '在地图上查看 ↗', locate: '定位这座城市 ↗', controls: '地图操作',
    zoomIn: '放大地图', zoomOut: '缩小地图', world: '回到世界全图',
    zoomLevel: ({ level }) => `放大 · 当前级别 ${level}`,
    help: '拖动 · 缩放 · 悬浮查看城市', canvas: '世界地图，可用方向键移动、加减键缩放',
    lightTheme: '切换到浅色模式', darkTheme: '切换到深色模式',
    language: 'Switch to English / 切换到英文', photosLabel: '城市照片', closePhoto: '关闭照片',
    visited: '到访', residence: '常住', frequent: '常去', undated: '未记录具体月份',
    cityCount: ({ count }) => `${count} 座城市`, countryCount: ({ count }) => `${count} 个国家`,
    results: ({ shown, total }) => `${shown} / ${total} 座城市`,
    viewCity: ({ city, visits }) => `查看${city}，${visits}`,
    noResults: '还没有找到这座城市', searchHint: '试试其他城市名，或放宽国家和年份。',
    back: '返回列表', visits: '到访记录', repeatVisits: '到访记录 · 再次相见', noMonth: '未记录具体到访月份。',
    representative: ({ alias, city }) => `清单中的「${alias}」，在地图上以${city}为代表点。`,
    album: '旅途相册', noPhotos: '还没有添加照片。把这段记忆留给下一次补全。',
    photoAlt: ({ city }) => `${city}的照片`, openPhoto: ({ city, number }) => `打开${city}的第 ${number} 张照片`,
    photoError: '照片暂时无法加载', story: '阅读城市故事 ↗', visitStory: ({ month }) => `${month}的旅行记录 ↗`,
    timelineNote: '按记录的月份回望。常住、常去的城市尚未记录具体月份，不排列进时间线。',
    noTimeline: '当前筛选下暂无带月份的记录。', cityUnit: '座城市与城镇', countryUnit: '个国家',
    recordedMonths: '已记录的月份', distribution: '足迹分布',
    statsNote: '同一城市多次到访只计一座城市。月份记录不等同于旅行次数。',
    errorTitle: '地图暂时没有展开', retry: '重新加载',
    fileError: '请通过项目说明中的本地预览服务打开地图，双击 HTML 文件无法加载城市数据。',
    loadError: '城市或地图数据加载失败，请检查网络连接后重新加载。',
    mapError: '请刷新页面；如果仍无法显示，请检查浏览器是否支持 WebGL。',
  },
};

const regions = {
  '福建': 'Fujian', '广东': 'Guangdong', '香港': 'Hong Kong', '澳门': 'Macao', '云南': 'Yunnan',
  '浙江': 'Zhejiang', '上海': 'Shanghai', '湖北': 'Hubei', '江苏': 'Jiangsu', '陕西': 'Shaanxi',
  '北京': 'Beijing', '黑龙江': 'Heilongjiang', '首尔': 'Seoul', '济州特别自治道': 'Jeju Province',
  '新加坡': 'Singapore', '吉隆坡联邦直辖区': 'Federal Territory of Kuala Lumpur',
  '加利福尼亚州': 'California', '马萨诸塞州': 'Massachusetts', '纽约州': 'New York',
  '日内瓦州': 'Canton of Geneva', '伯尔尼州': 'Canton of Bern', '伦巴第': 'Lombardy',
  '威尼托': 'Veneto', '托斯卡纳': 'Tuscany', '拉齐奥': 'Lazio', '伊奥尼亚群岛': 'Ionian Islands', '阿提卡': 'Attica',
};
const aliases = { '济州岛': 'Jeju Island', '扎金索斯': 'Zakynthos' };
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const monthFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', timeZone: 'UTC' });

export function createI18n(value = DEFAULT_LANGUAGE) {
  const language = resolveLanguage(value);
  const t = (key, params = {}) => {
    const message = messages[language][key];
    if (message == null) throw new Error(`Missing translation: ${language}/${key}`);
    return typeof message === 'function' ? message(params) : message;
  };
  const city = p => language === 'en' ? p.nameEn || p.name : p.name;
  const country = p => language === 'en' ? countryNames.of(p.countryCode) || p.country : p.country;
  const region = p => language === 'en' ? regions[p.region] || p.region : p.region;
  const month = value => language === 'zh'
    ? `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`
    : monthFormat.format(new Date(`${value}-01T00:00:00Z`));
  return {
    language, t, city, country, region, month,
    category: key => t(key),
    location: p => [country(p), region(p)].filter(Boolean).join(' / '),
    alias: p => language === 'en' ? aliases[p.sourceInput?.city] || p.sourceInput?.city : p.sourceInput?.city,
    visits: p => p.visits.length ? p.visits.map(v => month(v.when)).join(' · ') : `${t(p.category)} · ${t('undated')}`,
    summary: (cities, countries) => `${t('cityCount', { count: cities })} · ${t('countryCount', { count: countries })}`,
  };
}
