"""Build the optional search directory from GeoNames; runtime makes no API calls.
Python 3 standard library only. Raw downloads stay outside the repository.
Usage: python scripts/build-city-catalog.py <download-cache-directory>
"""
import sys, json, urllib.request, zipfile, io, re, hashlib, gzip
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
cache = Path(sys.argv[1]).resolve()
cache.mkdir(parents=True, exist_ok=True)
base = 'https://download.geonames.org/export/dump/'
sources = []
def download(name):
    target = cache / name
    if not target.exists():
        with urllib.request.urlopen(base + name, timeout=60) as response:
            target.write_bytes(response.read())
    raw = target.read_bytes()
    sources.append({'url': base + name, 'sha256': hashlib.sha256(raw).hexdigest()})
    return raw

admin = {}
for line in download('admin1CodesASCII.txt').decode('utf8').splitlines():
    fields = line.split('\t')
    if len(fields) >= 4: admin[fields[0]] = fields[2] or fields[1]
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
