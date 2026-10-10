// Display the world with equal longitude/latitude spacing, as in the original
// reference. MapLibre still operates in its native Mercator coordinate space:
// pre-warping latitude makes Mercator y linear in the ORIGINAL latitude.
// These coordinates exist only at the renderer boundary. Canonical WGS84 city
// coordinates, thumbnail geography, source files and visit records stay intact.
export function toDisplayCoordinates([longitude, latitude]) {
  const radians = latitude * Math.PI / 180;
  return [longitude, Math.atan(Math.sinh(radians)) * 180 / Math.PI];
}

export function projectCountries(collection) {
  const project = coordinates => typeof coordinates[0] === 'number'
    ? toDisplayCoordinates(coordinates)
    : coordinates.map(project);
  return {
    type: 'FeatureCollection',
    features: collection.features.map(feature => ({
      type: 'Feature',
      properties: feature.properties,
      geometry: { type: feature.geometry.type, coordinates: project(feature.geometry.coordinates) },
    })),
  };
}
