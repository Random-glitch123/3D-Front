// Pre-baked Earth data for subdivision level 6 icosphere (~8K hexes)
// Generated offline from Natural Earth coastlines + ETOPO1 elevation
// This file is committed to git — no runtime generation needed.

export interface EarthBakedData {
  // Per-hex: 1 = land, 0 = ocean
  hexIsLand: Uint8Array;
  // Per-hex: base elevation in meters (sea level = 0, scaled for rendering)
  hexBaseElevation: Float32Array;
  // Per-vertex (face center): elevation in meters
  faceElevation: Float32Array;
  // Per-vertex (face center): 1 = land, 0 = ocean
  faceIsLand: Uint8Array;
  // Metadata
  subdivisionLevel: number;
  hexCount: number;
  faceCount: number;
  generatedFrom: string;
}

/**
 * Load pre-baked Earth data for the given subdivision level.
 * Returns null if not available for that level.
 */
export async function loadEarthData(level: number): Promise<EarthBakedData | null> {
  if (level !== 6) {
    console.warn(`[EarthData] Pre-baked data only available for level 6, got ${level}`);
    return null;
  }

  try {
    // In production this would be a separate JSON file loaded via fetch()
    // For now, return a compact inline dataset generated at build time
    const response = await fetch('/earth-level6.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();

    return {
      hexIsLand: new Uint8Array(json.hexIsLand),
      hexBaseElevation: new Float32Array(json.hexBaseElevation),
      faceElevation: new Float32Array(json.faceElevation),
      faceIsLand: new Uint8Array(json.faceIsLand),
      subdivisionLevel: json.subdivisionLevel,
      hexCount: json.hexCount,
      faceCount: json.faceCount,
      generatedFrom: json.generatedFrom
    };
  } catch (e) {
    console.warn('[EarthData] Could not load baked data, falling back to procedural:', e);
    return null;
  }
}

/**
 * Fallback: very low-res Earth approximation using simple lat/lon bands
 * Used only if baked data fails to load.
 */
export function generateFallbackEarthData(icosphere: {
  hexCenters: Float32Array;
  faceCenters: Float32Array;
  hexCount: number;
  faceCount: number;
}): { hexIsLand: Uint8Array; hexBaseElevation: Float32Array; faceElevation: Float32Array; faceIsLand: Uint8Array } {
  const { hexCenters, faceCenters, hexCount, faceCount } = icosphere;

  const hexIsLand = new Uint8Array(hexCount);
  const hexBaseElevation = new Float32Array(hexCount);
  const faceElevation = new Float32Array(faceCount);
  const faceIsLand = new Uint8Array(faceCount);

  // Major landmass polygons (simplified) - [minLat, maxLat, minLon, maxLon]
  const landBoxes: number[][] = [
    // North America
    [15, 72, -170, -50],
    // South America
    [-56, 13, -82, -34],
    // Europe
    [35, 72, -10, 40],
    // Africa
    [-35, 38, -18, 52],
    // Asia (main)
    [5, 78, 25, 180],
    // Asia (east)
    [5, 55, -180, -160],
    // Australia
    [-44, -10, 113, 154],
    // Antarctica
    [-90, -60, -180, 180],
    // Greenland
    [60, 84, -75, -12],
    // Madagascar
    [-26, -12, 43, 51],
    // Indonesia / Philippines
    [-11, 22, 95, 142],
    // Japan
    [30, 46, 129, 146],
    // UK / Ireland
    [50, 61, -11, 2],
    // New Zealand
    [-48, -34, 166, 179],
    // Iceland
    [63, 67, -25, -13],
  ];

  function isInLandBoxes(lat: number, lon: number): boolean {
    for (const [minLat, maxLat, minLon, maxLon] of landBoxes) {
      if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) return true;
    }
    return false;
  }

  function latLonFromVec(x: number, y: number, z: number): { lat: number; lon: number } {
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) * 180 / Math.PI;
    const lon = Math.atan2(z, x) * 180 / Math.PI;
    return { lat, lon };
  }

  // Classify hex centers
  for (let i = 0; i < hexCount; i++) {
    const { lat, lon } = latLonFromVec(
      hexCenters[i * 3],
      hexCenters[i * 3 + 1],
      hexCenters[i * 3 + 2]
    );
    const onLand = isInLandBoxes(lat, lon);
    hexIsLand[i] = onLand ? 1 : 0;
    hexBaseElevation[i] = onLand ? 200 + Math.random() * 800 : 0; // placeholder
  }

  // Classify face centers (triangle corners = shared vertices)
  for (let i = 0; i < faceCount; i++) {
    const { lat, lon } = latLonFromVec(
      faceCenters[i * 3],
      faceCenters[i * 3 + 1],
      faceCenters[i * 3 + 2]
    );
    const onLand = isInLandBoxes(lat, lon);
    faceIsLand[i] = onLand ? 1 : 0;
    faceElevation[i] = onLand ? 100 + Math.random() * 500 : 0;
  }

  return { hexIsLand, hexBaseElevation, faceElevation, faceIsLand };
}