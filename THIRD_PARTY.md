# Third-party sources

## Natural Earth

- Source: https://github.com/nvkelso/natural-earth-vector
- Countries, 1:110m and 1:50m: `ne_110m_admin_0_countries.geojson`, `ne_50m_admin_0_countries.geojson`.
- License: public domain, https://www.naturalearthdata.com/about/terms-of-use/
- Retrieved 2026-10-09. Original download hashes are in `data/sources.json`.
- Unused country properties were removed; bundled geometries are unchanged. Rendering normalizes ring winding for D3, clips the view and omits Antarctica from the world overview.
- These generalized reference boundaries are for the travel visualization; city-country labels and counts follow the user's list rather than being inferred from map polygons.
- The interactive v0.3 world overview uses an equirectangular display. Country vertices, marker coordinates and camera bounds are converted at the MapLibre renderer boundary; bundled geographic files retain their original WGS84 coordinates. See `site/projection.js`.

## GeoNames

- Source: https://www.geonames.org/export/
- License: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/
- Coordinate system: WGS84 latitude/longitude in the source, written in GeoJSON longitude/latitude order.
- 37 selected records obtained from the GeoNames data bundled in geonamescache 3.0.2, https://pypi.org/project/geonamescache/3.0.2/ and https://github.com/yaph/geonamescache. This is a cached snapshot, not a claim of daily live geocoding.
- Mohe uses the separately reviewed GeoNames record 2033822 (122.526262 E, 52.97103 N): https://www.geonames.org/2033822/mohe.html and https://www.geonames.org/advanced-search.html?country=CN&q=Mohe
- The public dataset contains the reviewed representative coordinates and public display fields. Workbook rows, raw input dates and internal geocoding review metadata are not distributed with it. Dataset-level source information is retained in `data/sources.json`.
- Modifications: selected representative points, added user-defined Chinese/English display names and personal visit data, preserved the user's country grouping, and replaced two island labels with the main city/town following the user's request.

## D3

- D3 7.9.0, https://d3js.org/
- Bundled distribution: https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js
- License: ISC, full notice retained in `vendor/d3-LICENSE`.

## Place-name decisions

- Jeju City's role as the island's main urban center: https://m.visitjeju.net/en/themtour/view?contentsid=CNTS_300000000012881&menuId=DOM_200000000011166
- Zakynthos Town: https://www.visitgreece.gr/en/experiences/leisure/shopping/zakynthos-town

Personal visit dates were supplied by the user. The geographic sources support the city identities and representative locations, not the user's visits.

## Page-structure reference

TravelMap (https://map.pivi.dev/#/; https://github.com/thisispivi/TravelMap) inspired the full-page map, floating navigation and left card panel. This app is independently implemented. No source code, personal photos or travel records from that project are used by the application. Reference screenshots are not distributed in this repository.

## MapLibre GL JS

- Version 6.13.0: https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.13.0
- BSD-3-Clause; full notice retained in `vendor/maplibre/LICENSE.txt`.
- Official release archive: https://github.com/maplibre/maplibre-gl-js/releases/download/v6.13.0/dist.zip
- Archive SHA-256 verified before extraction: `f28f9e0fb0ef08f29504b5e447e50e095d69eb4bd098559f9f181fd8b05f2d17`.
- Production ESM module, worker and stylesheet retained unchanged; optional development source maps are not bundled. Individual file hashes are in `data/sources.json`.
- The app uses local GeoJSON and DOM markers; no online tile, font or geocoding service is requested.
