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
- Wishlist city search: `data/cities/` is a reduced snapshot of the official GeoNames `cities5000.zip`, `admin1CodesASCII.txt` and `alternateNamesV2.zip` (CC BY 4.0), downloaded 2026-10-11. It contains 69,789 populated-place records, split into 16 files by GeoNames ID, with names, selected aliases, country/region, WGS84 coordinates and population. Display names use explicitly language-tagged English and Chinese records; historic, closed-date-range and colloquial records are excluded. Simplified Chinese tags are preferred. Reviewed names and common pinyin for the 41 curated destinations and existing visited places take precedence. `locales.json` also supplies region labels and lets older saved wishes resolve current names without changing personal data. Missing Chinese names remain explicitly marked; population is a search tie-breaker, not a tourism ranking. Source URLs, download hashes, coverage and transformation date are in `data/cities/index.json`; regeneration uses `scripts/build-city-catalog.py`. This is a local snapshot, not live geocoding, and does not cover every small town. Field definitions: https://download.geonames.org/export/dump/readme.txt

## OpenCC (catalog build only)

- OpenCC 1.4.2, https://github.com/BYVoid/OpenCC, Apache-2.0.
- Used offline with the `t2s` configuration to normalize language-tagged Chinese names to Simplified Chinese; it does not translate untagged or foreign-language names. Incomplete Chinese labels containing Latin words are skipped instead of silently mixing display languages. The package is not shipped to browsers or required for ordinary website deployment. The build dependency is pinned in `scripts/requirements-catalog.txt`.

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
