import { createCitySearch } from './wishlist-model.js';

let ready;
async function load() {
  const shards = new Array(16);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < shards.length) {
      const index = next++;
      const response = await fetch(new URL(`../data/cities/${index}.json`, import.meta.url), { signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error('catalog_unavailable');
      shards[index] = await response.json();
    }
  }));
  return createCitySearch(shards.flat());
}
self.onmessage = async ({ data: { id, query, country } }) => {
  try {
    ready ||= load().catch(error => { ready = null; throw error; });
    const search = await ready;
    self.postMessage({ id, cities: search(query, country) });
  } catch { self.postMessage({ id, error: 'catalog_unavailable' }); }
};
