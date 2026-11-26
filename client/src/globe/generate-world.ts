// ============================================================================
// World Generator — real Earth coastlines -> hex tiles -> biomes
// Run with: npx tsx client/src/globe/generate-world.ts
//
// Output: client/public/world-map.json
//
// Geometry model:
//   * An icosphere (subdivided icosahedron) is generated.
//   * Each icosphere VERTEX becomes the CENTER of one hex tile.
//   * Each icosphere TRIANGLE's centroid becomes a shared CORNER vertex.
//   * Because corners are shared by index, neighbouring tiles are guaranteed
//     to be watertight — there are no gaps or overlaps anywhere.
//
// The 12 vertices of the original icosahedron have valence 5 and therefore
// produce pentagons. This is mathematically unavoidable for any hex grid on a
// sphere (Euler's formula); everything else is a hexagon.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Config
// ============================================================================

const SUBDIVISIONS = 5; // 10,242 tiles. Level 6 = 40,962
const RADIUS = 100;

// Biome ids (keep in sync with the renderer's palette lookup)
const BIOME = {
  OCEAN: 0,
  BEACH: 1,
  GRASSLAND: 2,
  FOREST: 3,
  DESERT: 4,
  TUNDRA: 5,
  SNOW: 6,
  ROCK: 7,
  ICE: 8,
} as const;

const BIOME_COLORS: Record<number, [number, number, number]> = {
  0: [0.16, 0.47, 0.74], // Ocean
  1: [0.90, 0.84, 0.62], // Beach
  2: [0.49, 0.68, 0.40], // Grassland
  3: [0.20, 0.44, 0.24], // Forest
  4: [0.85, 0.77, 0.54], // Desert
  5: [0.62, 0.67, 0.53], // Tundra
  6: [0.93, 0.95, 0.97], // Snow
  7: [0.52, 0.50, 0.46], // Rock
  8: [0.96, 0.98, 1.00], // Ice
};

// ============================================================================
// Small vector / noise helpers
// ============================================================================

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Fast deterministic integer hash -> [0, 1). Used for per-corner jitter and
// per-tile height noise so the world is identical on every run.
function hashInt(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return (x >>> 0) / 4294967296;
}

function hash33(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c000 = hash33(ix, iy, iz);
  const c100 = hash33(ix + 1, iy, iz);
  const c010 = hash33(ix, iy + 1, iz);
  const c110 = hash33(ix + 1, iy + 1, iz);
  const c001 = hash33(ix, iy, iz + 1);
  const c101 = hash33(ix + 1, iy, iz + 1);
  const c011 = hash33(ix, iy + 1, iz + 1);
  const c111 = hash33(ix + 1, iy + 1, iz + 1);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbm(x: number, y: number, z: number, octaves: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * noise3(x * freq, y * freq, z * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return value;
}

// ============================================================================
// 1. Icosphere
// ============================================================================

function generateIcosphere(subdivisions: number): {
  vertices: Vec3[];
  triangles: [number, number, number][];
} {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices: Vec3[] = [
    { x: -1, y: t, z: 0 }, { x: 1, y: t, z: 0 },
    { x: -1, y: -t, z: 0 }, { x: 1, y: -t, z: 0 },
    { x: 0, y: -1, z: t }, { x: 0, y: 1, z: t },
    { x: 0, y: -1, z: -t }, { x: 0, y: 1, z: -t },
    { x: t, y: 0, z: -1 }, { x: t, y: 0, z: 1 },
    { x: -t, y: 0, z: -1 }, { x: -t, y: 0, z: 1 },
  ].map(normalize);

  let triangles: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  // Midpoint cache keyed by the two endpoint indices. Using indices (rather
  // than float keys) guarantees that every shared edge resolves to the exact
  // same midpoint vertex, so the mesh has no cracks.
  const midpointCache = new Map<string, number>();
  function midpoint(a: number, b: number): number {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;

    const va = vertices[a];
    const vb = vertices[b];
    const idx = vertices.length;
    vertices.push(normalize({ x: va.x + vb.x, y: va.y + vb.y, z: va.z + vb.z }));
    midpointCache.set(key, idx);
    return idx;
  }

  for (let s = 0; s < subdivisions; s++) {
    const next: [number, number, number][] = [];
    for (const [a, b, c] of triangles) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    triangles = next;
  }

  return { vertices, triangles };
}

// ============================================================================
// 2. Dual mesh: icosphere -> hex / pentagon tiles
// ============================================================================

interface HexTile {
  id: number;
  center: Vec3;
  cornerIndices: number[];
  neighbors: number[];
  biome: number;
  elevation: number;
  isLand: boolean;
  coastDist: number; // graph steps from nearest ocean tile (0 = ocean)
  height: number; // radial displacement in world units
}

function buildHexTiles(
  vertices: Vec3[],
  triangles: [number, number, number][],
): { hexes: HexTile[]; corners: Vec3[] } {
  const vertCount = vertices.length;

  // Triangles touching each vertex.
  const vertTris: number[][] = Array.from({ length: vertCount }, () => []);
  for (let i = 0; i < triangles.length; i++) {
    for (const v of triangles[i]) vertTris[v].push(i);
  }

  // One shared corner per triangle = normalized triangle centroid.
  const corners: Vec3[] = triangles.map(([a, b, c]) =>
    normalize({
      x: vertices[a].x + vertices[b].x + vertices[c].x,
      y: vertices[a].y + vertices[b].y + vertices[c].y,
      z: vertices[a].z + vertices[b].z + vertices[c].z,
    }),
  );

  // Keep the regular grid - no corner jitter for cleaner, less random look
  // The shared corners ensure watertight mesh without gaps

  // Neighbouring vertices == neighbouring tiles.
  const neighborSets: Set<number>[] = Array.from({ length: vertCount }, () => new Set<number>());
  for (const [a, b, c] of triangles) {
    neighborSets[a].add(b); neighborSets[a].add(c);
    neighborSets[b].add(a); neighborSets[b].add(c);
    neighborSets[c].add(a); neighborSets[c].add(b);
  }

  const hexes: HexTile[] = [];

  for (let v = 0; v < vertCount; v++) {
    const tris = vertTris[v];
    if (tris.length < 5) {
      throw new Error(`Vertex ${v} has only ${tris.length} adjacent triangles`);
    }

    const center = vertices[v];

    // Build a tangent basis at the tile centre and sort its corners by angle
    // so the polygon winds consistently.
    const up = Math.abs(center.x) > 0.1 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const tx = {
      x: up.y * center.z - up.z * center.y,
      y: up.z * center.x - up.x * center.z,
      z: up.x * center.y - up.y * center.x,
    };
    const tlen = Math.hypot(tx.x, tx.y, tx.z) || 1;
    const tangent = { x: tx.x / tlen, y: tx.y / tlen, z: tx.z / tlen };
    const bitangent = {
      x: center.y * tangent.z - center.z * tangent.y,
      y: center.z * tangent.x - center.x * tangent.z,
      z: center.x * tangent.y - center.y * tangent.x,
    };

    const sorted = tris
      .map((triIdx) => {
        const c = corners[triIdx];
        const dx = c.x - center.x;
        const dy = c.y - center.y;
        const dz = c.z - center.z;
        const u = dx * tangent.x + dy * tangent.y + dz * tangent.z;
        const w = dx * bitangent.x + dy * bitangent.y + dz * bitangent.z;
        return { triIdx, angle: Math.atan2(w, u) };
      })
      .sort((a, b) => a.angle - b.angle);

    hexes.push({
      id: v,
      center,
      cornerIndices: sorted.map((s) => s.triIdx),
      neighbors: Array.from(neighborSets[v]),
      biome: BIOME.OCEAN,
      elevation: 0,
      isLand: false,
      coastDist: 0,
      height: 0,
    });
  }

  return { hexes, corners };
}

// ============================================================================
// 3. Real Earth land mask (Natural Earth 110m coastlines)
// ============================================================================

interface LandRing {
  pts: [number, number][];
  hole: boolean;
}

function loadLandRings(): LandRing[] {
  const raw = JSON.parse(
    readFileSync(join(__dirname, 'data/ne_110m_land.geojson'), 'utf8'),
  ) as {
    features: Array<{
      geometry: { type: string; coordinates: unknown } | null;
    }>;
  };

  const rings: LandRing[] = [];
  let antarcticRingIndex = 0;

  for (const feature of raw.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    const polygons: number[][][][] =
      geometry.type === 'Polygon'
        ? [geometry.coordinates as number[][][]]
        : (geometry.coordinates as number[][][][]);

    for (const polygon of polygons) {
      polygon.forEach((ring, ringIndex) => {
        let minLat = 90;
        for (const p of ring) if (p[1] < minLat) minLat = p[1];

        // Include Antarctica (minLat < -80) - we'll handle it with noise perturbation
        // and flood-fill instead of the old hardcoded circle.
        const pts = ring.map((p) => [p[0], p[1]] as [number, number]);

        if (minLat < -80) {
          // Apply subtle noise perturbation for jagged, realistic ice-shelf coastline
          const perturbed = perturbAntarcticRing(pts, antarcticRingIndex + 1);
          rings.push({
            pts: perturbed,
            hole: ringIndex > 0,
          });
          antarcticRingIndex++;
        } else {
          rings.push({
            pts,
            hole: ringIndex > 0,
          });
        }
      });
    }
  }

  return rings;
}

// Make a ring's longitudes continuous so edges crossing the antimeridian do
// not create a 360-degree horizontal line.
function unwrapRing(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    let lon = pts[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, pts[i][1]]);
  }
  return out;
}

// Add noise perturbation to Antarctic coastline vertices for jagged ice-shelf edges
// Amplitude increased for level 4 (larger hexes need more perturbation to show)
function perturbAntarcticRing(pts: [number, number][], seed: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [lon, lat] = pts[i];
    // Deterministic pseudo-random based on position + seed
    const hash = Math.sin(lon * 12.9898 + lat * 78.233 + seed) * 43758.5453;
    const rand = hash - Math.floor(hash);
    const hash2 = Math.sin(lon * 39.346 + lat * 11.135 + seed * 2) * 43758.5453;
    const rand2 = hash2 - Math.floor(hash2);
    // Larger perturbation (~0.3-1.0 degrees) for jagged coast at level 4
    const dLon = (rand - 0.5) * 1.5;
    const dLat = (rand2 - 0.5) * 1.5;
    out.push([lon + dLon, lat + dLat]);
  }
  return out;
}

const GRID_W = 2048;
const GRID_H = 1024;

function buildLandGrid(rings: LandRing[]): Uint8Array {
  const grid = new Uint8Array(GRID_W * GRID_H);

  for (const ring of rings) {
    const pts = unwrapRing(ring.pts);
    const value = ring.hole ? 0 : 1;

    let minLat = 90;
    let maxLat = -90;
    for (const p of pts) {
      if (p[1] < minLat) minLat = p[1];
      if (p[1] > maxLat) maxLat = p[1];
    }

    const yStart = Math.max(0, Math.floor(((90 - maxLat) / 180) * GRID_H));
    const yEnd = Math.min(GRID_H - 1, Math.ceil(((90 - minLat) / 180) * GRID_H));

    for (let y = yStart; y <= yEnd; y++) {
      const lat = 90 - ((y + 0.5) * 180) / GRID_H;
      const xs: number[] = [];

      for (let i = 0; i < pts.length; i++) {
        const [lon1, lat1] = pts[i];
        let lon2 = pts[(i + 1) % pts.length][0];
        const lat2 = pts[(i + 1) % pts.length][1];

        while (lon2 - lon1 > 180) lon2 -= 360;
        while (lon2 - lon1 < -180) lon2 += 360;

        if ((lat1 <= lat && lat2 > lat) || (lat2 <= lat && lat1 > lat)) {
          const k = (lat - lat1) / (lat2 - lat1);
          xs.push(lon1 + k * (lon2 - lon1));
        }
      }

      xs.sort((a, b) => a - b);

      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.ceil(((xs[i] + 180) / 360) * GRID_W - 0.5);
        const c1 = Math.floor(((xs[i + 1] + 180) / 360) * GRID_W - 0.5);
        for (let cx = c0; cx <= c1; cx++) {
          const wrapped = ((cx % GRID_W) + GRID_W) % GRID_W;
          grid[y * GRID_W + wrapped] = value;
        }
      }
    }
  }

  // Force Arctic to be ocean - no land above 70°N (Arctic Ocean)
  for (let y = 0; y < GRID_H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / GRID_H;
    if (lat > 70) {
      grid.fill(0, y * GRID_W, (y + 1) * GRID_W);
    }
  }

  // Add small isolated islands that may be missed by coastline rasterization
  // Radius adjusted for level 5 grid resolution (smaller degrees = more precision)
  // Hawaii
  addIsland(grid, -155.5, 19.5, 2.0);
  // Cuba
  addIsland(grid, -78.0, 21.5, 2.0);
  // Puerto Rico
  addIsland(grid, -66.5, 18.2, 1.5);
  // Jamaica
  addIsland(grid, -77.3, 18.1, 1.0);
  // Hispaniola (Haiti/DR) - extend existing Cuba area
  addIsland(grid, -71.0, 19.0, 2.0);
  // Bahamas
  addIsland(grid, -76.0, 24.0, 1.5);
  // Lesser Antilles
  addIsland(grid, -61.5, 15.5, 1.5);

  // Central America land bridge - ensure connected isthmus
  // Panama (Darién Gap)
  addIsland(grid, -78.5, 8.5, 1.0);
  // Costa Rica
  addIsland(grid, -84.0, 10.0, 1.0);
  // Nicaragua
  addIsland(grid, -85.0, 12.5, 1.0);
  // Honduras
  addIsland(grid, -86.5, 14.5, 1.0);
  // Guatemala
  addIsland(grid, -90.0, 15.5, 1.0);

  // Panama Canal / Darién Gap - single water hex connection between oceans
  // Narrowest point around 9°N, -79.5°W
  cutWater(grid, -79.5, 9.0, 0.8);
  // Wider Darién Gap water cut to ensure connection
  cutWater(grid, -78.0, 8.5, 1.0);

  // Middle East water bodies - narrow to preserve land
  // Persian Gulf
  cutWater(grid, 51.0, 26.5, 1.2);
  // Red Sea
  cutWater(grid, 38.0, 22.0, 2.5);
  // Gulf of Aden
  cutWater(grid, 47.0, 12.0, 1.2);
  // Caspian Sea (already landlocked, ensure it's water)
  cutWater(grid, 51.0, 41.0, 3.0);

  // Oceania islands
  // New Zealand (North Island)
  addIsland(grid, 175.0, -39.0, 1.5);
  // New Zealand (South Island)
  addIsland(grid, 171.0, -44.0, 1.5);
  // Papua New Guinea
  addIsland(grid, 147.0, -6.5, 2.0);
  // Philippines (Luzon)
  addIsland(grid, 121.0, 16.0, 1.5);
  // Philippines (Mindanao)
  addIsland(grid, 125.0, 7.5, 1.2);
  // Indonesia - Java
  addIsland(grid, 111.0, -7.5, 1.2);
  // Indonesia - Sumatra (northern tip)
  addIsland(grid, 98.0, 2.0, 1.2);
  // Borneo
  addIsland(grid, 114.0, 0.5, 1.5);
  // Sulawesi
  addIsland(grid, 120.0, -2.0, 1.2);
  // Fiji
  addIsland(grid, 178.0, -18.0, 0.8);
  // Solomon Islands
  addIsland(grid, 160.0, -9.0, 1.2);
  // Australia - strengthen presence
  // (Australia is large, but ensure key regions)
  // Timor
  addIsland(grid, 125.5, -9.0, 0.8);
  // Aru Islands
  addIsland(grid, 134.0, -6.0, 0.8);
  // Tasmania
  addIsland(grid, 146.0, -42.0, 1.0);

  // Additional Indonesian islands for better coverage at level 5
  // Sumatra (main body)
  addIsland(grid, 101.0, 0.0, 2.5);
  // Borneo (southern)
  addIsland(grid, 113.0, -2.0, 2.0);
  // Sulawesi (main body)
  addIsland(grid, 120.0, -3.0, 1.8);
  // Maluku Islands
  addIsland(grid, 128.0, -3.5, 1.5);
  // Lesser Sunda Islands (Bali, Lombok, etc.)
  addIsland(grid, 115.0, -8.5, 1.5);
  // Raja Ampat
  addIsland(grid, 131.0, -0.5, 1.0);
  // Western New Guinea
  addIsland(grid, 138.0, -4.0, 1.5);

  // Additional Australian coverage
  // Western Australia
  addIsland(grid, 121.0, -26.0, 1.5);
  // Northern Territory
  addIsland(grid, 133.0, -18.0, 1.5);
  // Queensland (Cape York)
  addIsland(grid, 142.0, -12.0, 1.5);
  // South Australia
  addIsland(grid, 135.0, -32.0, 1.5);
  // Victoria/NSW
  addIsland(grid, 145.0, -37.0, 1.0);

  return grid;
}

function addIsland(grid: Uint8Array, centerLon: number, centerLat: number, radiusDeg: number): void {
  const centerX = Math.floor(((centerLon + 180) / 360) * GRID_W);
  const centerY = Math.floor(((90 - centerLat) / 180) * GRID_H);
  const radiusX = Math.max(1, Math.round((radiusDeg / 360) * GRID_W));
  const radiusY = Math.max(1, Math.round((radiusDeg / 180) * GRID_H));

  for (let dy = -radiusY; dy <= radiusY; dy++) {
    const y = centerY + dy;
    if (y < 0 || y >= GRID_H) continue;
    for (let dx = -radiusX; dx <= radiusX; dx++) {
      const x = (centerX + dx + GRID_W) % GRID_W;
      // Elliptical falloff
      const dist2 = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY);
      if (dist2 <= 1.0) {
        grid[y * GRID_W + x] = 1;
      }
    }
  }
}

function cutWater(grid: Uint8Array, centerLon: number, centerLat: number, radiusDeg: number): void {
  const centerX = Math.floor(((centerLon + 180) / 360) * GRID_W);
  const centerY = Math.floor(((90 - centerLat) / 180) * GRID_H);
  const radiusX = Math.max(1, Math.round((radiusDeg / 360) * GRID_W));
  const radiusY = Math.max(1, Math.round((radiusDeg / 180) * GRID_H));

  for (let dy = -radiusY; dy <= radiusY; dy++) {
    const y = centerY + dy;
    if (y < 0 || y >= GRID_H) continue;
    for (let dx = -radiusX; dx <= radiusX; dx++) {
      const x = (centerX + dx + GRID_W) % GRID_W;
      const dist2 = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY);
      if (dist2 <= 1.0) {
        grid[y * GRID_W + x] = 0;
      }
    }
  }
}

function sampleLand(grid: Uint8Array, lat: number, lon: number): boolean {
  let x = Math.floor(((lon + 180) / 360) * GRID_W);
  let y = Math.floor(((90 - lat) / 180) * GRID_H);
  x = ((x % GRID_W) + GRID_W) % GRID_W;
  y = clamp(y, 0, GRID_H - 1);
  return grid[y * GRID_W + x] === 1;
}

// ============================================================================
// 4. Elevation + climate + biomes
// ============================================================================

interface Ellipse {
  lat: number;
  lon: number;
  rLat: number;
  rLon: number;
  v: number;
}

const MOUNTAINS: Ellipse[] = [
  { lat: -20, lon: -70, rLat: 28, rLon: 6, v: 3800 }, // Andes
  { lat: 45, lon: -115, rLat: 18, rLon: 12, v: 2800 }, // Rockies
  { lat: 33, lon: 85, rLat: 11, rLon: 22, v: 4500 }, // Himalayas
  { lat: 46, lon: 10, rLat: 4, rLon: 9, v: 2300 }, // Alps
  { lat: 60, lon: 60, rLat: 12, rLon: 5, v: 1400 }, // Urals
  { lat: 33, lon: 0, rLat: 6, rLon: 20, v: 1700 }, // Atlas
  { lat: -27, lon: 148, rLat: 14, rLon: 5, v: 1100 }, // Great Dividing
  { lat: 10, lon: 38, rLat: 8, rLon: 6, v: 1900 }, // Ethiopian Highlands
  { lat: -3, lon: 32, rLat: 16, rLon: 6, v: 1500 }, // East African Rift
  { lat: 38, lon: 100, rLat: 9, rLon: 16, v: 2600 }, // Tibetan Plateau
  { lat: 62, lon: -145, rLat: 10, rLon: 22, v: 2100 }, // Alaska Range
  { lat: 72, lon: -40, rLat: 12, rLon: 22, v: 2600 }, // Greenland ice sheet
];

const WET_REGIONS: Ellipse[] = [
  { lat: -5, lon: -60, rLat: 14, rLon: 20, v: 0.35 }, // Amazon
  { lat: 0, lon: 20, rLat: 9, rLon: 13, v: 0.32 }, // Congo
  { lat: 5, lon: 115, rLat: 16, rLon: 26, v: 0.32 }, // SE Asia
  { lat: 18, lon: 80, rLat: 13, rLon: 11, v: 0.22 }, // India
  { lat: 30, lon: 110, rLat: 13, rLon: 15, v: 0.22 }, // East China
  { lat: 38, lon: -85, rLat: 13, rLon: 20, v: 0.15 }, // US East
  { lat: 50, lon: 15, rLat: 12, rLon: 26, v: 0.15 }, // Europe
  { lat: -25, lon: -50, rLat: 12, rLon: 15, v: 0.20 }, // SE Brazil
  { lat: -30, lon: 150, rLat: 10, rLon: 8, v: 0.18 }, // East Australia
  { lat: 60, lon: 20, rLat: 10, rLon: 16, v: 0.12 }, // Scandinavia
  { lat: 55, lon: 120, rLat: 18, rLon: 40, v: 0.10 }, // Siberia taiga
  // Central America / Caribbean - tropical rainforest
  { lat: 12, lon: -85, rLat: 8, rLon: 12, v: 0.30 }, // Central America isthmus
  { lat: 15, lon: -88, rLat: 6, rLon: 8, v: 0.25 }, // Guatemala/Belize
  { lat: 18, lon: -77, rLat: 5, rLon: 8, v: 0.20 }, // Jamaica/Cuba region
  // Indonesia / Philippines - very wet tropical
  { lat: 0, lon: 120, rLat: 12, rLon: 18, v: 0.40 }, // Indonesia archipelago
  { lat: 13, lon: 122, rLat: 8, rLon: 12, v: 0.35 }, // Philippines
];

const DRY_REGIONS: Ellipse[] = [
  { lat: 22, lon: 10, rLat: 12, rLon: 30, v: 0.35 }, // Sahara
  { lat: 23, lon: 45, rLat: 18, rLon: 30, v: 0.65 }, // Arabia (very strong, very wide)
  { lat: -25, lon: 132, rLat: 13, rLon: 18, v: 0.35 }, // Australian interior
  { lat: -20, lon: -70, rLat: 11, rLon: 5, v: 0.35 }, // Atacama
  { lat: -23, lon: 20, rLat: 9, rLon: 13, v: 0.28 }, // Kalahari
  { lat: 32, lon: -110, rLat: 12, rLon: 15, v: 0.28 }, // SW United States
  { lat: 42, lon: 100, rLat: 10, rLon: 20, v: 0.25 }, // Gobi
  { lat: 32, lon: 55, rLat: 12, rLon: 16, v: 0.35 }, // Iranian plateau (stronger)
  { lat: -15, lon: -45, rLat: 10, rLon: 10, v: 0.15 }, // Brazilian sertao
  // Additional Middle East dry regions
  { lat: 30, lon: 38, rLat: 8, rLon: 12, v: 0.40 }, // Syria/Jordan desert
  { lat: 34, lon: 44, rLat: 6, rLon: 10, v: 0.35 }, // Iraq/Syria border
];

// Elliptical falloff; returns the strongest contribution at (lat, lon).
function ellipseValue(lat: number, lon: number, regions: Ellipse[]): number {
  let best = 0;
  for (const r of regions) {
    const dLat = (lat - r.lat) / r.rLat;
    let dLon = (lon - r.lon) / r.rLon;
    while (dLon > 180 / r.rLon) dLon -= 360 / r.rLon;
    while (dLon < -180 / r.rLon) dLon += 360 / r.rLon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < 1) {
      const contribution = r.v * (1 - d2);
      if (contribution > best) best = contribution;
    }
  }
  return best;
}

function elevationAt(v: Vec3, lat: number, lon: number, onLand: boolean): number {
  if (!onLand) return 0;

  const base = fbm(v.x * 4.5, v.y * 4.5, v.z * 4.5, 4); // 0..1-ish
  let elevation = 80 + base * 850;

  elevation += ellipseValue(lat, lon, MOUNTAINS);
  elevation += Math.max(0, Math.abs(lat) - 55) * 25;

  return Math.max(0, elevation);
}

function moistureAt(
  lat: number,
  lon: number,
  elevation: number,
  coastDistDeg: number,
): number {
  const absLat = Math.abs(lat);
  let m: number;

  if (absLat < 8) m = 0.78;
  else if (absLat < 18) m = 0.60;
  else if (absLat < 32) m = 0.30; // subtropical dry belt
  else if (absLat < 50) m = 0.58;
  else if (absLat < 65) m = 0.50;
  else m = 0.42;

  // Continental interiors are drier.
  m -= Math.min(0.18, coastDistDeg * 0.004);

  // Regional climate modifiers.
  m += ellipseValue(lat, lon, WET_REGIONS);
  m -= ellipseValue(lat, lon, DRY_REGIONS);

  // Rain shadow / altitude.
  m -= Math.min(0.12, elevation / 8000);

  return clamp(m, 0, 1);
}

function classifyBiome(
  lat: number,
  elevation: number,
  moisture: number,
  coastDist: number,
  isLand: boolean,
): number {
  const absLat = Math.abs(lat);

  if (!isLand) {
    // Sea ice around the poles.
    if (absLat > 70) return BIOME.ICE;
    return BIOME.OCEAN;
  }

  // Antarctica: force entire continent to ICE biome (ice sheet)
  if (lat < -60) return BIOME.ICE;

  if (absLat > 80) return BIOME.ICE;
  if (elevation > 4200) return BIOME.ROCK;

  if (absLat > 66) {
    if (elevation > 2200) return BIOME.SNOW;
    return BIOME.TUNDRA;
  }

  if (absLat > 55) {
    if (elevation > 2600) return BIOME.SNOW;
    if (moisture > 0.48) return BIOME.FOREST;
    return BIOME.TUNDRA;
  }

  // A single ring of sand along low-lying coasts.
  if (coastDist === 1 && elevation < 500) return BIOME.BEACH;

  if (elevation > 3000) return BIOME.ROCK;
  if (moisture < 0.24) return BIOME.DESERT;
  if (moisture > 0.55) return BIOME.FOREST;
  return BIOME.GRASSLAND;
}

// Radial displacement (world units) for a tile, derived from elevation and
// biome. Quantized to discrete height steps for a terraced/blocky look.
function computeTileHeight(hex: HexTile): number {
  if (!hex.isLand) {
    // Ocean: -0.2 (below datum), Sea ice: 0.35 (slightly above)
    return hex.biome === BIOME.ICE ? 0.35 : -0.2;
  }

  // Base height from elevation (normalized 0-1)
  const e = clamp(hex.elevation / 4500, 0, 1);
  let h = 0.22 + Math.pow(e, 0.9) * 2.7;

  // Biome modifiers
  switch (hex.biome) {
    case BIOME.ROCK: h += 0.55; break;
    case BIOME.SNOW: h += 0.35; break;
    case BIOME.DESERT: h += 0.18; break;
    case BIOME.FOREST: h += 0.12; break;
    case BIOME.TUNDRA: h += 0.06; break;
    case BIOME.BEACH: h = 0.1; break;
  }

  // Quantize to discrete height steps (0.3 world units per step)
  // This creates the terraced/stepped look where each hex is at a distinct level
  const stepSize = 0.3;
  h = Math.round(h / stepSize) * stepSize;

  // Ensure minimum height for land
  return Math.max(0.1, h);
}

// ============================================================================
// 5. Generate
// ============================================================================

function latLonFromVec(v: Vec3): { lat: number; lon: number } {
  return {
    lat: (Math.asin(clamp(v.y, -1, 1)) * 180) / Math.PI,
    lon: (Math.atan2(v.z, v.x) * 180) / Math.PI,
  };
}

function main() {
  console.log(`[GenWorld] Generating icosphere level ${SUBDIVISIONS}...`);
  const { vertices, triangles } = generateIcosphere(SUBDIVISIONS);
  console.log(`[GenWorld] ${vertices.length} tile centres, ${triangles.length} triangles`);

  const { hexes, corners } = buildHexTiles(vertices, triangles);
  console.log(
    `[GenWorld] ${hexes.length} tiles (${hexes.filter((h) => h.cornerIndices.length === 5).length} pentagons)`,
  );

  // --- Validate watertightness -------------------------------------------------
  const cornerUse = new Uint8Array(corners.length);
  for (const hex of hexes) {
    for (const ci of hex.cornerIndices) cornerUse[ci]++;
  }
  let badCorners = 0;
  let minUse = 255;
  let maxUse = 0;
  for (const use of cornerUse) {
    if (use !== 3) badCorners++;
    if (use < minUse) minUse = use;
    if (use > maxUse) maxUse = use;
  }
  console.log(
    `[GenWorld] Corner sharing: every corner used by 3 tiles? ${badCorners === 0 ? 'YES' : 'NO'} (min=${minUse}, max=${maxUse}, bad=${badCorners})`,
  );

  // --- Real Earth land mask ----------------------------------------------------
  console.log('[GenWorld] Rasterising Natural Earth coastlines...');
  const landGrid = buildLandGrid(loadLandRings());

  for (const hex of hexes) {
    const { lat, lon } = latLonFromVec(hex.center);
    hex.isLand = sampleLand(landGrid, lat, lon);
  }

  // Distance to the nearest ocean tile (in tile-graph steps).
  const queue: number[] = [];
  for (const hex of hexes) {
    if (!hex.isLand) {
      hex.coastDist = 0;
      queue.push(hex.id);
    } else {
      hex.coastDist = -1;
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const nb of hexes[id].neighbors) {
      if (hexes[nb].coastDist === -1) {
        hexes[nb].coastDist = hexes[id].coastDist + 1;
        queue.push(nb);
      }
    }
  }

  // Approximate degrees per tile-graph step (for the moisture model).
  const degreesPerStep = 360 / Math.sqrt(2.598 * hexes.length);

  // --- Elevation + biomes ------------------------------------------------------
  const biomeCounts: Record<number, number> = {};
  for (const hex of hexes) {
    const { lat, lon } = latLonFromVec(hex.center);
    hex.elevation = Math.round(elevationAt(hex.center, lat, lon, hex.isLand));
    const moisture = moistureAt(lat, lon, hex.elevation, hex.coastDist * degreesPerStep);
    hex.biome = classifyBiome(lat, hex.elevation, moisture, hex.coastDist, hex.isLand);
    biomeCounts[hex.biome] = (biomeCounts[hex.biome] ?? 0) + 1;
  }

  // --- Height field ------------------------------------------------------------
  // Each tile gets its own quantized height (no corner averaging).
  // This gives the terraced/stepped look where each hex is a flat plate
  // at a distinct height level.
  for (const hex of hexes) {
    hex.height = computeTileHeight(hex);
  }

  // Corner heights = each corner takes the height of ONE of its adjacent tiles
  // (the first one in the list). This keeps the mesh watertight while
  // preserving the per-tile stepped heights.
  const cornerHeights = new Float64Array(corners.length);
  const cornerAssigned = new Uint8Array(corners.length);
  for (const hex of hexes) {
    for (const ci of hex.cornerIndices) {
      if (cornerAssigned[ci] === 0) {
        cornerHeights[ci] = hex.height;
        cornerAssigned[ci] = 1;
      }
    }
  }
  // Any unassigned corners (shouldn't happen) get default ocean height
  for (let i = 0; i < corners.length; i++) {
    if (cornerAssigned[i] === 0) cornerHeights[i] = -0.2;
  }

  // --- Serialise ---------------------------------------------------------------
  const flatCorners: number[] = [];
  for (const c of corners) flatCorners.push(c.x, c.y, c.z);

  const output = {
    meta: {
      name: 'earth',
      subdivisions: SUBDIVISIONS,
      radius: RADIUS,
      hexCount: hexes.length,
      cornerCount: corners.length,
      triangleCount: triangles.length,
      biomeColors: BIOME_COLORS,
    },
    corners: flatCorners,
    cornerHeights: Array.from(cornerHeights, (h) => Number(h.toFixed(3))),
    hexes: hexes.map((h) => ({
      id: h.id,
      center: [h.center.x, h.center.y, h.center.z],
      corners: h.cornerIndices,
      neighbors: h.neighbors,
      biome: h.biome,
      elevation: h.elevation,
      height: Number(h.height.toFixed(3)),
    })),
  };

  const outPath = resolve(__dirname, '../../public/world-map.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output));

  const landCount = hexes.filter((h) => h.isLand).length;
  console.log(`[GenWorld] Written to ${outPath}`);
  console.log(
    `[GenWorld] Land: ${landCount}/${hexes.length} (${((landCount / hexes.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    '[GenWorld] Biomes:',
    Object.entries(biomeCounts)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, count]) => `${id}:${count}`)
      .join(' '),
  );
}

main();
