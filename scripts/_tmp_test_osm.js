const { searchPlaces } = require('../server/place-search.js');
(async () => {
  for (const q of ['kafe', 'Akcaabat eczane', 'uzungol kahvalti']) {
    const r = await searchPlaces({ query: q, lat: 41.0027, lng: 39.7168, limit: 6 });
    console.log('==', q, 'configured=', r.configured, 'providers=', r.providers.join(','), 'errors=', JSON.stringify(r.errors));
    for (const i of r.items) console.log('  -', i.name, '|', i.category, '|', i.source, i.externalId || '');
  }
})();

