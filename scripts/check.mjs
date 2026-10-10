import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlaces } from './data.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(await fs.readFile(path.join(root,'data/places.geojson'),'utf8'));
const stats=validatePlaces(data);
const byId=new Map(data.features.map(f=>[f.id,f]));
for (const f of data.features) {
  const p=f.properties;
  // The public dataset is canonical. Private workbook rows and raw dates are not required.
  const allowed=['name','nameEn','displayName','country','countryCode','region','category','visits','photos','link','note','sourceInput'];
  for (const key of Object.keys(p)) assert(allowed.includes(key),`${f.id}: review unexpected public field ${key}`);
  if (p.sourceInput) assert.deepEqual(Object.keys(p.sourceInput),['city'],`${f.id}: keep only the public search alias`);
  if (p.category !== 'visited') assert.deepEqual(p.visits,[],`${f.id}: keep undated residence/frequent records undated`);
}
for (const [file,expected] of [
  ['travel-map.svg',data.features],
  ['travel-map-details.svg',data.features.filter(f=>['CN','KR','CH','IT','GR'].includes(f.properties.countryCode))]
]) {
  const svg=await fs.readFile(path.join(root,'assets',file),'utf8');
  assert(!/(?:NaN|Infinity|undefined)/.test(svg),`${file}: invalid numerical output`);
  assert(!/<(?:script|foreignObject|image)\b|(?:https?:)?\/\/.*?\.(?:woff|ttf)/i.test(svg),`${file}: non-standalone content`);
  const ids=[...svg.matchAll(/data-place-id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,`${file}: duplicate markers`);
  assert.deepEqual(ids.sort(),expected.map(f=>f.id).sort(),`${file}: missing or unexpected markers`);
  for (const id of ids) {
    const p=byId.get(id).properties;
    for (const v of p.visits) assert(svg.includes(v.when),`${id}: month missing from SVG title`);
  }
  assert(svg.includes('aria-labelledby="map-title map-desc"'));
}
const report=JSON.parse(await fs.readFile(path.join(root,'docs/build-check.json'),'utf8'));
assert.equal(report.labelOverlaps,0);
assert.equal(report.places,stats.places);
assert.equal(report.monthEntries,stats.monthEntries);
console.log(JSON.stringify({result:'PASS',checks:['public data fields','unknown-date preservation','unique city identities','coordinate ranges','complete SVG marker and month sets','standalone SVG content','label collision check'],...stats}));
