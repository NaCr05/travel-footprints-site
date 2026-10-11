"""Build the optional search directory from GeoNames; runtime makes no API calls.
Install scripts/requirements-catalog.txt first. Raw downloads stay outside the repository.
Usage: python scripts/build-city-catalog.py <download-cache-directory>
"""
import sys, json, urllib.request, zipfile, io, re, hashlib, gzip, shutil
from pathlib import Path
from datetime import datetime, timezone
from opencc import OpenCC

simplify = OpenCC('t2s').convert

root = Path(__file__).resolve().parents[1]
cache = Path(sys.argv[1]).resolve()
cache.mkdir(parents=True, exist_ok=True)
base = 'https://download.geonames.org/export/dump/'
sources = []
def source_path(name):
    target = cache / name
    if not target.exists():
        with urllib.request.urlopen(base + name, timeout=60) as response:
            temporary = target.with_suffix('.download')
            with temporary.open('wb') as output: shutil.copyfileobj(response, output)
            temporary.replace(target)
    with target.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    sources.append({'url': base + name, 'sha256': digest})
    return target

def download(name): return source_path(name).read_bytes()

admin, admin_ids = {}, {}
for line in download('admin1CodesASCII.txt').decode('utf8').splitlines():
    fields = line.split('\t')
    if len(fields) >= 4:
        admin[fields[0]] = fields[2] or fields[1]
        admin_ids[fields[0]] = fields[3]
raw = download('cities5000.zip')
with zipfile.ZipFile(io.BytesIO(raw)) as z:
    lines = z.read('cities5000.txt').decode('utf8').splitlines()
rows = []
for line in lines:
    f = line.split('\t')
    if len(f) < 19 or f[6] != 'P': continue
    names = [f[1], f[2]] + f[3].split(',')
    # Retain CJK aliases and a few Latin spellings, not every world language.
    cjk = [n for n in names if n and re.fullmatch(r'[\u3400-\u9fff·・ ]{1,70}', n)]
    latin = [n for n in names if n and re.fullmatch(r'[A-Za-zÀ-ž0-9 .’\x27-]{1,70}', n)]
    aliases = list(dict.fromkeys(cjk[:10] + latin[:5]))
    rows.append({'id': f[0], 'nameEn': f[2] or f[1], 'nameZh': '', 'countryCode': f[8],
                 'region': admin.get(f'{f[8]}.{f[10]}', ''), 'coordinates': [float(f[5]),float(f[4])],
                 'aliases': aliases, 'population': int(f[14] or 0)})

# The convenience aliases above are NOT language-tagged (a Han name can be
# Japanese). Only explicit GeoNames language records may supply display labels.
original_en = {c['id']: c['nameEn'] for c in rows}
needed = set(original_en) | set(admin_ids.values())
labels, ranks = {}, {}
zh_languages = {'zh-CN': 0, 'zh-Hans': 1, 'zh-SG': 2, 'zh': 3, 'zh-Hant': 4, 'zh-TW': 5, 'zh-HK': 6}
with zipfile.ZipFile(source_path('alternateNamesV2.zip')) as archive:
    with archive.open('alternateNamesV2.txt') as stream:
        for line in io.TextIOWrapper(stream, encoding='utf8'):
            f = line.rstrip('\r\n').split('\t')
            if len(f) < 8 or f[1] not in needed or f[6] == '1' or f[7] == '1': continue
            # A closed date range describes a former name even if not flagged.
            if len(f) > 9 and f[9]: continue
            lang = 'en' if f[2] == 'en' else 'zh' if f[2] in zh_languages else None
            if not lang or not f[3].strip() or len(f[3]) > 200: continue
            # Partially translated entries (e.g. Chinese prefix + Latin city)
            # are not a complete Chinese label. Keep the explicit fallback.
            if lang == 'zh' and (not re.search(r'[\u3400-\u9fff]', f[3]) or re.search(r'[A-Za-z]', f[3])): continue
            rank = (zh_languages.get(f[2], 0), f[4] != '1', f[5] != '1', int(f[0]))
            key = (f[1], lang)
            if key not in ranks or rank < ranks[key]:
                ranks[key] = rank
                labels.setdefault(f[1], {})[lang] = simplify(f[3].strip()) if lang == 'zh' else f[3].strip()
for city in rows:
    translated = labels.get(city['id'], {})
    city['nameEn'] = translated.get('en', city['nameEn'])
    city['nameZh'] = translated.get('zh', '')
    city['aliases'] = list(dict.fromkeys([original_en[city['id']], *city['aliases']]))

# Editorial destinations, NOT a ranking of popularity or personal wishes.
choices = [
 ('Tokyo','JP','东京','dongjing'),('Kyoto','JP','京都','jingdu'),('Osaka','JP','大阪','daban'),
 ('Paris','FR','巴黎','bali'),('London','GB','伦敦','lundun'),('Barcelona','ES','巴塞罗那','basailuona'),
 ('Reykjavik','IS','雷克雅未克','leikeyaweike'),('Bangkok','TH','曼谷','mangu'),('Chiang Mai','TH','清迈','qingmai'),
 ('Chengdu','CN','成都','chengdu'),('Chongqing','CN','重庆','chongqing'),('Sapporo','JP','札幌','zhahuang'),
 ('Istanbul','TR','伊斯坦布尔','yisitanbuer'),('Cairo','EG','开罗','kailuo'),('Lisbon','PT','里斯本','lisiben'),
 ('Amsterdam','NL','阿姆斯特丹','amusitedan'),('Prague','CZ','布拉格','bulage'),('Vienna','AT','维也纳','weiyena'),
 ('Sydney','AU','悉尼','xini'),('Melbourne','AU','墨尔本','moerben'),('Auckland','NZ','奥克兰','aokelan'),
 ('Vancouver','CA','温哥华','wengehua'),('Toronto','CA','多伦多','duolunduo'),('San Francisco','US','旧金山','jiujinshan'),
 ('New York City','US','纽约','niuyue'),('Rome','IT','罗马','luoma'),('Florence','IT','佛罗伦萨','foluolunsa'),
 ('Athens','GR','雅典','yadian'),('Seoul','KR','首尔','shouer'),('Singapore','SG','新加坡','xinjiapo'),
 ('Kuala Lumpur','MY','吉隆坡','jilongpo'),('Beijing','CN','北京','beijing'),('Shanghai','CN','上海','shanghai'),
 ("Xi'an",'CN','西安','xian'),('Hangzhou','CN','杭州','hangzhou'),('Kunming','CN','昆明','kunming'),
 ('Lijiang','CN','丽江','lijiang'),('Harbin','CN','哈尔滨','haerbin'),('Xiamen','CN','厦门','xiamen'),
 ('Guangzhou','CN','广州','guangzhou'),('Shenzhen','CN','深圳','shenzhen')
]
def normalize(s): return re.sub(r'[\s\x27’-]', '', s).lower()
recommended = []
for en, country, zh, pinyin in choices:
    matches = [c for c in rows if c['countryCode'] == country and normalize(en) in [normalize(n) for n in [c['nameEn'], *c['aliases']]]]
    if not matches: raise ValueError(f'Missing destination: {en} {country}')
    city = max(matches, key=lambda c:c['population'])
    city['nameZh'] = zh
    city['aliases'] = list(dict.fromkeys([zh, pinyin, *city['aliases']]))
    recommended.append(city['id'])

# Link existing travel records by country and nearest representative point.
places = json.loads((root/'data/places.geojson').read_text('utf8'))
for f in places['features']:
    p=f['properties']; lon,lat=f['geometry']['coordinates']
    candidates=[c for c in rows if c['countryCode']==p['countryCode'] or (p['countryCode']=='CN' and c['countryCode'] in ['HK','MO'])]
    city=min(candidates,key=lambda c:(c['coordinates'][0]-lon)**2+(c['coordinates'][1]-lat)**2)
    if (city['coordinates'][0]-lon)**2+(city['coordinates'][1]-lat)**2 < .01:
        city['visitedId']=f['id'];city['nameEn']=p['nameEn'];city['nameZh']=p['name']
        city['aliases']=list(dict.fromkeys([p['name'],p['nameEn'],*city['aliases']]))

output=root/'data/cities'; output.mkdir(exist_ok=True)
rows.sort(key=lambda c:(-c['population'],c['id']))
by_id={c['id']:c for c in rows}
manifest={'schemaVersion':1,'updatedOn':datetime.now(timezone.utc).date().isoformat(),'source':'GeoNames','license':'CC BY 4.0','sources':sources,'count':len(rows),'recommended':[by_id[i] for i in recommended],'shards':[]}
# Saved wishes contain a snapshot of names. Resolve current display labels by
# stable ID without rewriting the owner's reasons, timestamps or coordinates.
# Regions live here once, rather than repeating a translation in every city.
locales = {'schemaVersion': 1, 'cities': {}, 'regions': {}}
for city in rows:
    if city['nameZh'] or city['nameEn'] != original_en[city['id']]:
        locales['cities'][city['id']] = [city['nameEn'], city['nameZh']]
for code, geoname_id in admin_ids.items():
    translated = labels.get(geoname_id, {})
    if translated:
        locales['regions'][f'{code.split(".")[0]}:{admin[code]}'] = [translated.get('en', admin[code]), translated.get('zh', '')]
(output/'locales.json').write_text(json.dumps(locales,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
manifest['locales'] = 'locales.json'
manifest['localizedCitiesZh'] = sum(bool(c['nameZh']) for c in rows)
manifest['localizedRegionsZh'] = sum(bool(v[1]) for v in locales['regions'].values())
manifest['nameNormalization'] = {'tool': 'OpenCC', 'version': '1.4.2', 'config': 't2s', 'scope': 'language-tagged Chinese labels only'}
# Fixed numeric ID buckets stay below GitHub Contents API's 1MB inline limit.
buckets={str(i):[] for i in range(16)}
for city in rows:buckets[str(int(city['id'])%16)].append(city)
total=compressed=0
for key,cities in buckets.items():
    content=json.dumps(cities,ensure_ascii=False,separators=(',',':')).encode('utf8')
    assert len(content)<950000
    (output/f'{key}.json').write_bytes(content+b'\n')
    manifest['shards'].append(f'{key}.json'); total+=len(content);compressed+=len(gzip.compress(content))
(output/'index.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
print(json.dumps({'cities':len(rows),'recommendations':len(recommended),'bytes':total,'gzipBytes':compressed,'largestShard':max((output/f'{i}.json').stat().st_size for i in range(16))}))
