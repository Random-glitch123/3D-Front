// Build-time script to generate earth-level6.json from real coastlines
// Run with: npx tsx client/src/globe/generate-earth-data.ts
// Outputs to client/public/earth-level6.json

import { generateIcosphere } from './icosahedron';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ContinentalCore {
  centerLat: number;
  centerLon: number;
  radiusLat: number;
  radiusLon: number;
  strength: number;
}

// Continental cores at Earth's major landmass locations (small ellipses)
const CORES: ContinentalCore[] = [
  // North America
  { centerLat: 45, centerLon: -100, radiusLat: 25, radiusLon: 45, strength: 1.0 },
  // South America
  { centerLat: -15, centerLon: -60, radiusLat: 30, radiusLon: 25, strength: 0.9 },
  // Europe
  { centerLat: 52, centerLon: 12, radiusLat: 16, radiusLon: 30, strength: 0.7 },
  // Africa
  { centerLat: 5, centerLon: 20, radiusLat: 35, radiusLon: 35, strength: 0.9 },
  // Eurasia West (Europe to Urals)
  { centerLat: 58, centerLon: 60, radiusLat: 22, radiusLon: 35, strength: 0.8 },
  // Eurasia Central (Siberia)
  { centerLat: 62, centerLon: 110, radiusLat: 20, radiusLon: 45, strength: 0.7 },
  // East Asia
  { centerLat: 38, centerLon: 112, radiusLat: 20, radiusLon: 30, strength: 0.8 },
  // Southeast Asia
  { centerLat: 0, centerLon: 115, radiusLat: 20, radiusLon: 35, strength: 0.6 },
  // Australia (stronger, wider)
  { centerLat: -25, centerLon: 135, radiusLat: 25, radiusLon: 30, strength: 0.8 },
  // Greenland
  { centerLat: 72, centerLon: -42, radiusLat: 12, radiusLon: 22, strength: 0.8 },
  // Antarctica - multiple smaller cores for jagged, realistic coastline
  // (replaces single ring core; noise adds further irregularity)
  { centerLat: -70, centerLon: -60, radiusLat: 12, radiusLon: 25, strength: 0.9 },  // Antarctic Peninsula
  { centerLat: -75, centerLon: 0, radiusLat: 15, radiusLon: 30, strength: 0.8 },   // East Antarctica (partial)
  { centerLat: -78, centerLon: 100, radiusLat: 10, radiusLon: 25, strength: 0.8 },  // Queen Maud Land
  { centerLat: -82, centerLon: -120, radiusLat: 8, radiusLon: 20, strength: 0.7 },  // Marie Byrd Land
  { centerLat: -85, centerLon: 60, radiusLat: 6, radiusLon: 18, strength: 0.6 },   // Transantarctic Mtns
  // Madagascar
  { centerLat: -20, centerLon: 47, radiusLat: 5, radiusLon: 5, strength: 0.7 },
  // New Zealand
  { centerLat: -41, centerLon: 173, radiusLat: 7, radiusLon: 8, strength: 0.7 },
  // Iceland
  { centerLat: 65, centerLon: -19, radiusLat: 2, radiusLon: 5, strength: 0.7 },
  // Japan
  { centerLat: 38, centerLon: 138, radiusLat: 6, radiusLon: 10, strength: 0.8 },
  // UK
  { centerLat: 54, centerLon: -3, radiusLat: 4, radiusLon: 7, strength: 0.5 },
  // Svalbard (real Arctic land - keep)
  { centerLat: 78, centerLon: 20, radiusLat: 2, radiusLon: 8, strength: 0.5 },
  // Philippines (stronger)
  { centerLat: 13, centerLon: 122, radiusLat: 9, radiusLon: 12, strength: 0.8 },
  // Borneo
  { centerLat: 1, centerLon: 114, radiusLat: 5, radiusLon: 8, strength: 0.7 },
  // New Guinea
  { centerLat: -6, centerLon: 141, radiusLat: 6, radiusLon: 10, strength: 0.8 },
  // Sumatra
  { centerLat: 0, centerLon: 102, radiusLat: 6, radiusLon: 8, strength: 0.7 },
  // Sulawesi
  { centerLat: -2, centerLon: 120, radiusLat: 5, radiusLon: 8, strength: 0.7 },
  // Java
  { centerLat: -7.5, centerLon: 111, radiusLat: 3, radiusLon: 5, strength: 0.7 },
  // Sri Lanka
  { centerLat: 8, centerLon: 81, radiusLat: 1.5, radiusLon: 1.5, strength: 0.5 },
  // Taiwan
  { centerLat: 24, centerLon: 121, radiusLat: 1.5, radiusLon: 2.5, strength: 0.8 },
  // Arabia (stronger desert)
  { centerLat: 23, centerLon: 45, radiusLat: 18, radiusLon: 30, strength: 0.0 }, // Desert core (handled by dry regions)
  // Iran plateau
  { centerLat: 32, centerLon: 55, radiusLat: 8, radiusLon: 12, strength: 0.5 },
  // Turkey
  { centerLat: 39, centerLon: 35, radiusLat: 6, radiusLon: 10, strength: 0.6 },
  // Egypt / Nile
  { centerLat: 27, centerLon: 30, radiusLat: 8, radiusLon: 6, strength: 0.5 },
];

function hash33(x: number, y: number, z: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise3(p: { x: number; y: number; z: number }): number {
  const i = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  const f = { x: p.x - i.x, y: p.y - i.y, z: p.z - i.z };
  const u = { x: f.x * f.x * (3.0 - 2.0 * f.x), y: f.y * f.y * (3.0 - 2.0 * f.y), z: f.z * f.z * (3.0 - 2.0 * f.z) };
  const a = hash33(i.x, i.y, i.z);
  const b = hash33(i.x + 1, i.y, i.z);
  const c = hash33(i.x, i.y + 1, i.z);
  const d = hash33(i.x + 1, i.y + 1, i.z);
  const e = hash33(i.x, i.y, i.z + 1);
  const f1 = hash33(i.x + 1, i.y, i.z + 1);
  const g = hash33(i.x, i.y + 1, i.z + 1);
  const h = hash33(i.x + 1, i.y + 1, i.z + 1);
  const k0 = a;
  const k1 = b - a;
  const k2 = c - a;
  const k3 = e - a;
  const k4 = a - b - c + d;
  const k5 = a - c - e + g;
  const k6 = a - b - e + f1;
  const k7 = a - b - c + d - e + f1 + g - h;
  return k0 + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
}

function fbm3(p: { x: number; y: number; z: number }, octaves: number): number {
  let value = 0.0;
  let amplitude = 0.5;
  let frequency = 1.0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise3({ x: p.x * frequency, y: p.y * frequency, z: p.z * frequency });
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

function landScore(lon: number, lat: number): number {
  // Force North Pole (Arctic Ocean) to be ocean - no land above 85°N
  if (lat > 85) return -1.0;

  // Latitude bias: more land in NH mid-latitudes
  const latBias = 1.0 - Math.abs(lat) / 90.0 * 0.25;

  // Continental cores - elliptical falloff
  let score = 0;
  for (const c of CORES) {
    const dLat = (lat - c.centerLat) / c.radiusLat;
    let dLon = (lon - c.centerLon) / c.radiusLon;
    while (dLon > 180 / c.radiusLon) dLon -= 360 / c.radiusLon;
    while (dLon < -180 / c.radiusLon) dLon += 360 / c.radiusLon;
    const dist2 = dLat * dLat + dLon * dLon;
    if (dist2 < 1.0) {
      score = Math.max(score, (1.0 - dist2 * 0.85) * c.strength);
    }
  }

  // Continental-scale noise for irregular coastlines
  const n1 = fbm3({ x: lon * 0.02, y: lat * 0.02, z: 100 }, 4);
  const n2 = fbm3({ x: lon * 0.05, y: lat * 0.05, z: 200 }, 3);
  score += (n1 * 0.3 + n2 * 0.15) * latBias;

  // Ocean basins (subtract land)
  // Pacific
  if ((lon > 130 || lon < -80) && lat > -55 && lat < 55) score -= 0.4;
  // Atlantic
  if (lon > -80 && lon < 15 && lat > -55 && lat < 55) score -= 0.35;
  // Indian Ocean
  if (lon > 20 && lon < 120 && lat > -45 && lat < 25) score -= 0.4;

  // Major water bodies
  // Mediterranean
  if (lon > -5 && lon < 36 && lat > 30 && lat < 46) score -= 0.6;
  // Hudson Bay
  if (lon > -95 && lon < -75 && lat > 52 && lat < 65) score -= 0.6;
  // Gulf of Mexico
  if (lon > -98 && lon < -82 && lat > 18 && lat < 30) score -= 0.6;
  // Baltic Sea
  if (lon > 12 && lon < 28 && lat > 54 && lat < 65) score -= 0.6;
  // Red Sea (narrower)
  if (lon > 34 && lon < 42 && lat > 14 && lat < 28) score -= 0.5;
  // Great Lakes
  if (lon > -93 && lon < -76 && lat > 42 && lat < 49) score -= 0.6;
  // Caspian Sea
  if (lon > 47 && lon < 55 && lat > 38 && lat < 46) score -= 0.6;
  // South China Sea
  if (lon > 108 && lon < 122 && lat > 2 && lat < 22) score -= 0.5;
  // Persian Gulf (narrower)
  if (lon > 50 && lon < 55 && lat > 25 && lat < 30) score -= 0.6;
  // Gulf of Aden
  if (lon > 46 && lon < 49 && lat > 11 && lat < 13) score -= 0.5;
  // Panama Canal / Darién Gap
  if (lon > -81 && lon < -78 && lat > 7 && lat < 11) score -= 1.0;

  return score;
}

function isOnLand(lon: number, lat: number): boolean {
  // Check main land score
  if (landScore(lon, lat) > 0.28) return true;
  
  // Add small islands that may be missed by core-based generation
  // Hawaii
  if (isInIsland(lon, lat, -155.5, 19.5, 0.5)) return true;
  // Cuba
  if (isInIsland(lon, lat, -78.0, 21.5, 1.0)) return true;
  // Puerto Rico
  if (isInIsland(lon, lat, -66.5, 18.2, 0.3)) return true;
  // Jamaica
  if (isInIsland(lon, lat, -77.3, 18.1, 0.3)) return true;
  // Hispaniola (Haiti/DR)
  if (isInIsland(lon, lat, -71.0, 19.0, 0.8)) return true;

  // Panama Canal / Darién Gap - ensure water
  if (isInIsland(lon, lat, -79.5, 9.0, 1.0)) return false;

  // Oceania islands
  // New Zealand (North Island)
  if (isInIsland(lon, lat, 175.0, -39.0, 2.5)) return true;
  // New Zealand (South Island)
  if (isInIsland(lon, lat, 171.0, -44.0, 2.5)) return true;
  // Papua New Guinea
  if (isInIsland(lon, lat, 147.0, -6.5, 3.0)) return true;
  // Philippines (Luzon)
  if (isInIsland(lon, lat, 121.0, 16.0, 2.5)) return true;
  // Philippines (Mindanao)
  if (isInIsland(lon, lat, 125.0, 7.5, 2.0)) return true;
  // Indonesia - Java
  if (isInIsland(lon, lat, 111.0, -7.5, 2.0)) return true;
  // Indonesia - Sumatra (northern tip)
  if (isInIsland(lon, lat, 98.0, 2.0, 2.0)) return true;
  // Borneo
  if (isInIsland(lon, lat, 114.0, 0.5, 2.5)) return true;
  // Sulawesi
  if (isInIsland(lon, lat, 120.0, -2.0, 2.0)) return true;
  // Fiji
  if (isInIsland(lon, lat, 178.0, -18.0, 1.0)) return true;
  // Solomon Islands
  if (isInIsland(lon, lat, 160.0, -9.0, 2.0)) return true;

  // Additional Caribbean
  // Bahamas
  if (isInIsland(lon, lat, -76.0, 24.0, 2.0)) return true;
  // Lesser Antilles
  if (isInIsland(lon, lat, -61.5, 15.5, 2.0)) return true;

  // Central America land bridge
  // Panama (Darién Gap)
  if (isInIsland(lon, lat, -78.5, 8.5, 1.0)) return true;
  // Costa Rica
  if (isInIsland(lon, lat, -84.0, 10.0, 1.0)) return true;
  // Nicaragua
  if (isInIsland(lon, lat, -85.0, 12.5, 1.0)) return true;
  // Honduras
  if (isInIsland(lon, lat, -86.5, 14.5, 1.0)) return true;
  // Guatemala
  if (isInIsland(lon, lat, -90.0, 15.5, 1.0)) return true;

  // Middle East - ensure land connections
  // Turkey (already covered by core)
  // Iran (already covered by core)
  // Egypt / Sinai
  if (isInIsland(lon, lat, 34.0, 28.5, 1.5)) return true;
  // Arabian Peninsula - ensure solid land
  if (isInIsland(lon, lat, 45.0, 24.0, 2.5)) return true; // UAE/Oman
  if (isInIsland(lon, lat, 45.0, 18.0, 2.0)) return true; // Yemen
  if (isInIsland(lon, lat, 50.0, 22.0, 1.5)) return true; // Oman interior

  // Additional Oceania islands
  // Timor
  if (isInIsland(lon, lat, 125.5, -9.0, 0.8)) return true;
  // Aru Islands
  if (isInIsland(lon, lat, 134.0, -6.0, 0.8)) return true;
  // Tasmania
  if (isInIsland(lon, lat, 146.0, -42.0, 1.0)) return true;

  return false;
}

function isInIsland(lon: number, lat: number, centerLon: number, centerLat: number, radiusDeg: number): boolean {
  const dLon = lon - centerLon;
  const dLat = lat - centerLat;
  // Handle longitude wrapping
  const dLonWrapped = dLon > 180 ? dLon - 360 : dLon < -180 ? dLon + 360 : dLon;
  const dist2 = (dLonWrapped * dLonWrapped) / (radiusDeg * radiusDeg) + (dLat * dLat) / (radiusDeg * radiusDeg);
  return dist2 <= 1.0;
}

function syntheticElevation(lon: number, lat: number, onLand: boolean): number {
  if (!onLand) return 0;
  let elev = 0;
  const absLat = Math.abs(lat);
  if (absLat > 50) elev += 400;
  if (absLat > 30 && absLat < 50) elev += 300;
  if (absLat > 30 && absLat < 50) {
    if ((lon > -125 && lon < -100) || (lon > -10 && lon < 20) ||
        (lon > 70 && lon < 100) || (lon > -80 && lon < -65)) {
      elev += 1500;
    }
  }
  const hash = Math.abs(Math.sin(lon * 127.1 + lat * 311.7) * 43758.5453);
  const frac = hash - Math.floor(hash);
  elev += frac * 400;
  return Math.max(0, elev);
}

function latLonFromVec(x: number, y: number, z: number): { lat: number; lon: number } {
  const lat = Math.asin(Math.max(-1, Math.min(1, y))) * 180 / Math.PI;
  const lon = Math.atan2(z, x) * 180 / Math.PI;
  return { lat, lon };
}

async function main() {
  console.log('[GenEarth] Generating icosphere level 6...');
  const ico = await generateIcosphere(6, false);
  console.log(`[GenEarth] ${ico.hexCount} hexes, ${ico.faceCount} faces`);

  const hexIsLand = new Uint8Array(ico.hexCount);
  const hexBaseElevation = new Float32Array(ico.hexCount);
  const faceElevation = new Float32Array(ico.faceCount);
  const faceIsLand = new Uint8Array(ico.faceCount);

  for (let i = 0; i < ico.hexCount; i++) {
    const { lat, lon } = latLonFromVec(
      ico.hexCenters[i * 3], ico.hexCenters[i * 3 + 1], ico.hexCenters[i * 3 + 2]
    );
    const onLand = isOnLand(lon, lat);
    hexIsLand[i] = onLand ? 1 : 0;
    hexBaseElevation[i] = syntheticElevation(lon, lat, onLand);
  }

  for (let i = 0; i < ico.faceCount; i++) {
    const { lat, lon } = latLonFromVec(
      ico.faceCenters[i * 3], ico.faceCenters[i * 3 + 1], ico.faceCenters[i * 3 + 2]
    );
    const onLand = isOnLand(lon, lat);
    faceIsLand[i] = onLand ? 1 : 0;
    faceElevation[i] = syntheticElevation(lon, lat, onLand);
  }

  const landHexes = hexIsLand.reduce((a, b) => a + b, 0);
  const landFaces = faceIsLand.reduce((a, b) => a + b, 0);
  console.log(`[GenEarth] Land hexes: ${landHexes}/${ico.hexCount} (${(landHexes / ico.hexCount * 100).toFixed(1)}%)`);
  console.log(`[GenEarth] Land faces: ${landFaces}/${ico.faceCount}`);
  console.log(`[GenEarth] Max hex elevation: ${Math.max(...hexBaseElevation).toFixed(0)}m`);

  const output = {
    subdivisionLevel: 6,
    hexCount: ico.hexCount,
    faceCount: ico.faceCount,
    generatedFrom: 'Continental cores + noise + ocean basins',
    hexIsLand: Array.from(hexIsLand),
    hexBaseElevation: Array.from(hexBaseElevation),
    faceElevation: Array.from(faceElevation),
    faceIsLand: Array.from(faceIsLand)
  };

  const outPath = resolve(__dirname, '../../public/earth-level6.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output));
  console.log(`[GenEarth] Written to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
