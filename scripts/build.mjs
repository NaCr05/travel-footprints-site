import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { validatePlaces } from './data.mjs';

const require = createRequire(import.meta.url);
const d3 = require('../vendor/d3.min.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const [places, low, medium] = await Promise.all([
  read('data/places.geojson'), read('data/basemaps/world-110m.geojson'), read('data/basemaps/world-50m.geojson')
]);
const stats = validatePlaces(places);
const features = places.features;
const C = { bg:'#171b20', ocean:'#1d252d', land:'#35414b', border:'#202b34', grid:'#2a353f',
  ink:'#edf1f3', muted:'#a7b5c0', faint:'#778b99', teal:'#72cfda', amber:'#edbd79', rule:'#36434d' };
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const n = value => Number(value.toFixed(2));
const text = (x,y,value,size=20,color=C.ink,extra='') => `<text x="${n(x)}" y="${n(y)}" font-size="${size}" fill="${color}" ${extra}>${esc(value)}</text>`;
const rect = (x,y,w,h,fill,stroke='none',radius=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
function start(w,h,title,desc) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="map-title map-desc"><title id="map-title">${esc(title)}</title><desc id="map-desc">${esc(desc)}</desc><style>text{font-family:"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif} .city-label{paint-order:stroke;stroke:${C.ocean};stroke-width:5px;stroke-linejoin:round}</style>${rect(0,0,w,h,C.bg)}`;
}
// D3 uses clockwise exteriors for small spherical polygons. Preserve the bundled
// GeoJSON, and normalize winding only in the rendering copy.
function orientGeometry(geometry) {
  if (geometry.type === 'Polygon') {
    return d3.geoArea(geometry) > 2 * Math.PI ? { ...geometry, coordinates:geometry.coordinates.map(ring => [...ring].reverse()) } : geometry;
  }
  if (geometry.type === 'MultiPolygon') return { ...geometry, coordinates:geometry.coordinates.map(coordinates => orientGeometry({type:'Polygon',coordinates}).coordinates) };
  return geometry;
}
const land = source => ({type:'FeatureCollection',features:source.features.filter(f => f.properties.ADMIN !== 'Antarctica').map(f => ({...f,geometry:orientGeometry(f.geometry)}))});
const lowLand = land(low);
const detailLand = land(medium);
function geography(projection, data, id, box, gridStep=[30,30]) {
  const p = d3.geoPath(projection).digits(2);
  const grid = d3.geoGraticule().step(gridStep)();
  return `<defs><clipPath id="${id}">${rect(...box,'white')}</clipPath></defs><g clip-path="url(#${id})"><path d="${p(grid)}" fill="none" stroke="${C.grid}" stroke-width="0.8"/>` + data.features.map(f => `<path d="${p(f) || ''}" fill="${C.land}" stroke="${C.border}" stroke-width="0.8" stroke-linejoin="round"/>`).join('') + '</g>';
}
function point(f, projection, radius=4.8, prefix='') {
  const [x,y] = projection(f.geometry.coordinates);
  const p = f.properties;
  const time = p.visits.length ? p.visits.map(v=>v.when).join('、') : {residence:'常住',frequent:'常去'}[p.category];
  const fill = p.category === 'residence' ? C.amber : p.category === 'frequent' ? C.ocean : C.teal;
  const stroke = p.category === 'frequent' ? C.teal : C.ocean;
  return `<g data-place-id="${esc(f.id)}" id="${prefix}${esc(f.id)}"><title>${esc(`${p.displayName} · ${p.country} · ${time}`)}</title><circle cx="${n(x)}" cy="${n(y)}" r="${radius+2}" fill="${C.ocean}" fill-opacity="0.7"/><circle cx="${n(x)}" cy="${n(y)}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${p.category === 'frequent' ? 2 : 1.3}"/></g>`;
}
const markerOrder = items => [...items].sort((a,b) => ({visited:0,frequent:1,residence:2}[a.properties.category])-({visited:0,frequent:1,residence:2}[b.properties.category]));
function legend(x,y) {
  return `<circle cx="${x}" cy="${y-5}" r="5.2" fill="${C.teal}"/>${text(x+15,y,'到访',17,C.muted)}<circle cx="${x+94}" cy="${y-5}" r="5.2" fill="${C.amber}"/>${text(x+109,y,'常住',17,C.muted)}<circle cx="${x+188}" cy="${y-5}" r="5.2" fill="${C.ocean}" stroke="${C.teal}" stroke-width="2"/>${text(x+203,y,'常去',17,C.muted)}`;
}
function mercator(bounds, box) {
  const [[west,south],[east,north]] = bounds;
  const [x,y,w,h] = box;
  const p = d3.geoMercator().scale(1).translate([0,0]);
  const a = p([west,north]), b=p([east,south]);
  const scale = Math.min(w/(b[0]-a[0]),h/(b[1]-a[1]));
  return p.scale(scale).translate([x+(w-(b[0]-a[0])*scale)/2-a[0]*scale,y+(h-(b[1]-a[1])*scale)/2-a[1]*scale]).clipExtent([[x,y],[x+w,y+h]]);
}
const intersects = (a,b,padding=0) => a.x < b.x+b.w+padding && a.x+a.w+padding > b.x && a.y < b.y+b.h+padding && a.y+a.h+padding > b.y;
function labels(items, projection, box, font=20) {
  const [bx,by,bw,bh] = box;
  const pts = items.map(f => ({f,p:projection(f.geometry.coordinates)}));
  // Solve denser clusters first; candidate positions move labels, never city points.
  pts.sort((a,b) => pts.filter(q=>Math.hypot(q.p[0]-b.p[0],q.p[1]-b.p[1])<75).length-pts.filter(q=>Math.hypot(q.p[0]-a.p[0],q.p[1]-a.p[1])<75).length || a.f.id.localeCompare(b.f.id));
  const occupied = [];
  const placements = [];
  for (const {f,p:[px,py]} of pts) {
    const name = f.properties.name;
    const width = [...name].reduce((sum,c)=>sum+(c.charCodeAt(0)>255 ? font : font*.58),0)+2;
    const height = font+6;
    const candidates = [];
    for (const gap of [12,24,42,64,90,118]) {
      for (const angle of [0,Math.PI,-Math.PI/2,Math.PI/2,-Math.PI/4,Math.PI/4,-3*Math.PI/4,3*Math.PI/4]) {
        const cx=px+Math.cos(angle)*(gap+width/2), cy=py+Math.sin(angle)*(gap+height/2);
        const r={x:cx-width/2,y:cy-height/2,w:width,h:height};
        if (r.x<bx || r.y<by || r.x+r.w>bx+bw || r.y+r.h>by+bh) continue;
        const collision=occupied.filter(b=>intersects(r,b,5)).length;
        const pointCollision=pts.filter(q=>intersects(r,{x:q.p[0]-7,y:q.p[1]-7,w:14,h:14},2)).length;
        candidates.push({...r,score:collision*100000+pointCollision*10000+gap+Math.abs(angle)*1.3});
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    const r=candidates[0];
    if (!r) throw new Error(`No label position for ${name}`);
    occupied.push(r);
    placements.push({f,p:[px,py],r});
  }
  const conflicts = [];
  for (let i=0;i<placements.length;i++) for(let j=i+1;j<placements.length;j++) if(intersects(placements[i].r,placements[j].r,2)) conflicts.push([placements[i].f.id,placements[j].f.id]);
  if (conflicts.length) throw new Error(`Overlapping labels: ${JSON.stringify(conflicts)}`);
  const lines=placements.map(({p:[px,py],r})=>{
    const x=Math.max(r.x,Math.min(px,r.x+r.w)),y=Math.max(r.y,Math.min(py,r.y+r.h));
    return `<path d="M${n(px)} ${n(py)}L${n(x)} ${n(y)}" fill="none" stroke="${C.faint}" stroke-width="0.85" opacity="0.85"/>`;
  }).join('');
  const words=placements.map(({f,r})=>text(r.x,r.y+font,f.properties.name,font,C.ink,'class="city-label"')).join('');
  return {markup:lines+words,placements:placements.map(({f,p,r})=>({id:f.id,point:p.map(n),label:r})),conflicts};
}

await fs.mkdir(path.join(root,'assets'),{recursive:true});
const countryLine = [...new Set(features.map(f=>f.properties.country))].map(country=>`${country} ${features.filter(f=>f.properties.country===country).length}`).join('     ·     ');
let world = start(1600,900,'Places I’ve Visited — 旅行足迹',`${stats.places}个地点，${stats.countries}个国家。月份记录从${stats.dateRange[0]}至${stats.dateRange[1]}。常住与常去另以颜色和空心点表示。`);
world+=text(54,47,'PERSONAL ATLAS  /  01',13,C.faint,'letter-spacing="2.4"');
world+=text(51,113,'Places I’ve Visited',49,C.ink,'font-weight="600"');
world+=text(54,153,'旅行足迹 · 把走过的地方，留在地图上',20,C.muted);
world+=text(1210,108,String(stats.places),48,C.teal,'font-weight="600"')+text(1282,108,'个地点',17,C.muted);
world+=text(1390,108,String(stats.countries),48,C.teal,'font-weight="600"')+text(1435,108,'个国家',17,C.muted);
world+=rect(46,190,1508,594,C.ocean,C.rule,18);
const globalProjection=d3.geoNaturalEarth1().fitExtent([[66,218],[1534,750]],lowLand);
world+=geography(globalProjection,lowLand,'world-clip',[54,207,1492,568]);
world+=markerOrder(features).map(f=>point(f,globalProjection,4.5,'world-')).join('');
const globalLabels=labels(features.filter(f=>['los-angeles','new-york','boston','singapore'].includes(f.id)),globalProjection,[65,224,1468,525],18);
world+=globalLabels.markup;
world+=text(75,225,'世界总览',15,C.muted)+legend(1210,225);
world+=text(54,824,countryLine,18,C.muted);
world+=text(54,868,`已记录月份 ${stats.dateRange[0].replace('-','.')} — ${stats.dateRange[1].replace('-','.')}  ·  城市代表点`,15,C.faint);
world+=text(1546,868,'Map: Natural Earth · Points: GeoNames (CC BY 4.0)',13,C.faint,'text-anchor="end"');
world+='</svg>\n';
await fs.writeFile(path.join(root,'assets/travel-map.svg'),world);

let details=start(1600,1110,'旅行足迹 — 东亚与欧洲放大图','东亚25个地点与欧洲8个地点的局部放大图。城市标记保持原始坐标；名称通过引线避让。');
details+=text(54,48,'PERSONAL ATLAS  /  02',13,C.faint,'letter-spacing="2.4"');
details+=text(51,112,'走近每一座城市',43,C.ink,'font-weight="600"');
details+=text(54,151,'密集地区放大 · 与世界总览使用同一份城市数据',20,C.muted)+legend(1240,142);
details+=rect(46,187,932,819,C.ocean,C.rule,18)+rect(999,187,555,819,C.ocean,C.rule,18);
details+=text(75,232,'东亚',26,C.ink,'font-weight="600"')+text(165,231,'25 个地点',17,C.muted);
details+=text(1027,232,'欧洲',26,C.ink,'font-weight="600"')+text(1120,231,'8 个地点',17,C.muted);
const eastItems=features.filter(f=>['CN','KR'].includes(f.properties.countryCode));
const europeItems=features.filter(f=>['CH','IT','GR'].includes(f.properties.countryCode));
const eastBox=[67,266,887,699];
const europeBox=[1017,300,518,638];
const eastProjection=mercator([[96,19],[135,55]],eastBox);
const europeProjection=mercator([[3,35.5],[28,49]],europeBox);
details+=geography(eastProjection,detailLand,'east-clip',eastBox,[10,10]);
details+=geography(europeProjection,detailLand,'europe-clip',europeBox,[5,5]);
const eastLabels=labels(eastItems,eastProjection,[79,277,866,677],19);
const europeLabels=labels(europeItems,europeProjection,[1027,314,499,608],19);
details+=eastLabels.markup+europeLabels.markup;
details+=markerOrder(eastItems).map(f=>point(f,eastProjection,5.1,'east-')).join('');
details+=markerOrder(europeItems).map(f=>point(f,europeProjection,5.1,'europe-')).join('');
details+=text(76,984,'济州岛 → 济州市',15,C.muted);
details+=text(1028,984,'扎金索斯岛 → 扎金索斯镇',15,C.muted);
details+=text(54,1043,'说明：标记位于城市代表点；引线仅用于标注名称。两幅局部图比例尺不同。',16,C.muted);
details+=text(54,1080,'Map: Natural Earth · Points: GeoNames (CC BY 4.0)',13,C.faint);
details+='</svg>\n';
await fs.writeFile(path.join(root,'assets/travel-map-details.svg'),details);
await fs.writeFile(path.join(root,'docs/build-check.json'),JSON.stringify({
  ...stats,svgMarkers:{world:features.length,eastAsia:eastItems.length,europe:europeItems.length},
  labelOverlaps:globalLabels.conflicts.length+eastLabels.conflicts.length+europeLabels.conflicts.length,
  dataUpdatedOn:places.updatedOn,scope:'Local data and SVG build; does not establish website deployment.'
},null,2)+'\n');
console.log(JSON.stringify({written:['assets/travel-map.svg','assets/travel-map-details.svg'],...stats}));
