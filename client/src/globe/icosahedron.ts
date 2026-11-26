// Icosahedron generator with subdivision and dual mesh (hexagon grouping)
// Pure TypeScript, no Three.js dependency — outputs typed arrays for GPU

export interface IcosphereData {
  // Base triangles (subdivided icosahedron)
  positions: Float32Array;        // [x, y, z] × vertexCount
  indices: Uint32Array;           // Triangle indices (3 per triangle)
  faceCenters: Float32Array;      // [x, y, z] × faceCount
  faceNormals: Float32Array;      // [x, y, z] × faceCount
  neighbors: Uint32Array;         // 3 neighbor face indices per face (Uint32Array length = faceCount * 3)

  // Dual mesh (hexagons/pentagons)
  hexCenters: Float32Array;       // [x, y, z] × hexCount (~8K at level 6)
  hexNormals: Float32Array;       // Same as centers (on unit sphere)
  hexNeighbors: Uint32Array;      // 6 neighbors per hex (5 for 12 pentagons)
  hexTriangleIndices: Uint32Array; // 6 triangle indices per hex (for picking/rendering)
  hexFaceCount: Uint8Array;       // 6 for hex, 5 for pentagon (per hex)
  hexIsLand: Uint8Array;          // 1 = land, 0 = water (per hex)

  // Baked Earth data (for level 6)
  hexBaseElevation?: Float32Array;   // Base elevation in meters (per hex)
  faceElevation?: Float32Array;      // Elevation at face centers (shared vertices)
  faceIsLand?: Uint8Array;           // Land flag at face centers

  // Metadata
  subdivisionLevel: number;
  vertexCount: number;
  faceCount: number;
  hexCount: number;
  pentagonIndices: number[];      // Indices of the 12 pentagons
}

// Simple 3D noise for land/sea classification
function hash33(vec: { x: number; y: number; z: number }): number {
  let x = vec.x * 127.1 + vec.y * 311.7 + vec.z * 74.7;
  let y = vec.x * 269.5 + vec.y * 183.3 + vec.z * 246.1;
  let z = vec.x * 113.3 + vec.y * 419.7 + vec.z * 157.3;
  const n = Math.sin(x) * 43758.5453 + Math.sin(y) * 43758.5453 + Math.sin(z) * 43758.5453;
  return n - Math.floor(n);
}

function noise3(p: { x: number; y: number; z: number }): number {
  const i = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  const f = { x: p.x - i.x, y: p.y - i.y, z: p.z - i.z };
  const u = { x: f.x * f.x * (3.0 - 2.0 * f.x), y: f.y * f.y * (3.0 - 2.0 * f.y), z: f.z * f.z * (3.0 - 2.0 * f.z) };

  const a = hash33({ x: i.x, y: i.y, z: i.z });
  const b = hash33({ x: i.x + 1, y: i.y, z: i.z });
  const c = hash33({ x: i.x, y: i.y + 1, z: i.z });
  const d = hash33({ x: i.x + 1, y: i.y + 1, z: i.z });
  const e = hash33({ x: i.x, y: i.y, z: i.z + 1 });
  const f1 = hash33({ x: i.x + 1, y: i.y, z: i.z + 1 });
  const g = hash33({ x: i.x, y: i.y + 1, z: i.z + 1 });
  const h = hash33({ x: i.x + 1, y: i.y + 1, z: i.z + 1 });

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

/**
 * Generate icosphere data at given subdivision level.
 * Level 0 = 20 faces (icosahedron), each level splits each triangle into 4.
 * Level 6: ~40K faces, ~8K hexes | Level 7: ~160K faces, ~32K hexes
 */
export async function generateIcosphere(level: number = 6, loadBaked: boolean = true): Promise<IcosphereData> {
  if (level < 0 || level > 7) {
    throw new Error('Subdivision level must be 0-7');
  }

  // ---- 1. Base icosahedron (12 vertices, 20 faces) ----
  const t = (1 + Math.sqrt(5)) / 2; // Golden ratio

  const baseVertices: number[] = [
    // 12 vertices of icosahedron
    -1,  t,  0,   1,  t,  0,   -1, -t,  0,   1, -t,  0,
     0, -1,  t,   0,  1,  t,    0, -1, -t,   0,  1, -t,
     t,  0, -1,   t,  0,  1,   -t,  0, -1,  -t,  0,  1
  ];

  const baseFaces: number[] = [
    // 20 faces (counter-clockwise winding)
    0, 11, 5,   0, 5, 1,    0, 1, 7,    0, 7, 10,   0, 10, 11,
    1, 5, 9,    5, 11, 4,   11, 10, 2,  10, 7, 6,   7, 1, 8,
    3, 9, 4,    3, 4, 2,    3, 2, 6,    3, 6, 8,    3, 8, 9,
    4, 9, 5,    2, 4, 11,   6, 2, 10,   8, 6, 7,    9, 8, 1
  ];

  // Normalize base vertices to unit sphere
  const vertices: number[] = [];
  for (let i = 0; i < baseVertices.length; i += 3) {
    const x = baseVertices[i];
    const y = baseVertices[i + 1];
    const z = baseVertices[i + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    vertices.push(x / len, y / len, z / len);
  }

  // ---- 2. Subdivide recursively ----
  let faces = [...baseFaces];
  const edgeCache = new Map<string, number>();

  function getMidpoint(i1: number, i2: number): number {
    const key = i1 < i2 ? `${i1},${i2}` : `${i2},${i1}`;
    const cached = edgeCache.get(key);
    if (cached !== undefined) return cached;

    const x1 = vertices[i1 * 3], y1 = vertices[i1 * 3 + 1], z1 = vertices[i1 * 3 + 2];
    const x2 = vertices[i2 * 3], y2 = vertices[i2 * 3 + 1], z2 = vertices[i2 * 3 + 2];

    const mx = x1 + x2, my = y1 + y2, mz = z1 + z2;
    const len = Math.sqrt(mx * mx + my * my + mz * mz);

    const idx = vertices.length / 3;
    vertices.push(mx / len, my / len, mz / len);
    edgeCache.set(key, idx);
    return idx;
  }

  for (let l = 0; l < level; l++) {
    const newFaces: number[] = [];
    edgeCache.clear();

    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i], b = faces[i + 1], c = faces[i + 2];
      const ab = getMidpoint(a, b);
      const bc = getMidpoint(b, c);
      const ca = getMidpoint(c, a);

      // 4 triangles per original
      newFaces.push(a, ab, ca,   ab, b, bc,   ca, bc, c,   ab, bc, ca);
    }
    faces = newFaces;
  }

  const vertexCount = vertices.length / 3;
  const faceCount = faces.length / 3;

  // ---- 3. Build typed arrays ----
  const positions = new Float32Array(vertices);
  const indices = new Uint32Array(faces);

  // ---- 4. Compute face centers & normals ----
  const faceCenters = new Float32Array(faceCount * 3);
  const faceNormals = new Float32Array(faceCount * 3);

  for (let i = 0; i < faceCount; i++) {
    const ia = indices[i * 3] * 3;
    const ib = indices[i * 3 + 1] * 3;
    const ic = indices[i * 3 + 2] * 3;

    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];

    // Face center (average of vertices, projected to sphere)
    let fx = ax + bx + cx;
    let fy = ay + by + cy;
    let fz = az + bz + cz;
    const flen = Math.sqrt(fx * fx + fy * fy + fz * fz);
    fx /= flen; fy /= flen; fz /= flen;

    faceCenters[i * 3] = fx;
    faceCenters[i * 3 + 1] = fy;
    faceCenters[i * 3 + 2] = fz;

    // Face normal = face center (on unit sphere)
    faceNormals[i * 3] = fx;
    faceNormals[i * 3 + 1] = fy;
    faceNormals[i * 3 + 2] = fz;
  }

  // ---- 5. Build face adjacency (neighbors) ----
  // Edge -> face mapping
  const edgeToFaces = new Map<string, number[]>();
  for (let i = 0; i < faceCount; i++) {
    const a = indices[i * 3];
    const b = indices[i * 3 + 1];
    const c = indices[i * 3 + 2];
    const edges = [
      a < b ? `${a},${b}` : `${b},${a}`,
      b < c ? `${b},${c}` : `${c},${b}`,
      c < a ? `${c},${a}` : `${a},${c}`
    ];
    for (const edge of edges) {
      const arr = edgeToFaces.get(edge) || [];
      arr.push(i);
      edgeToFaces.set(edge, arr);
    }
  }

  const neighbors = new Uint32Array(faceCount * 3);
  for (let i = 0; i < faceCount; i++) {
    const a = indices[i * 3];
    const b = indices[i * 3 + 1];
    const c = indices[i * 3 + 2];
    const edges = [
      a < b ? `${a},${b}` : `${b},${a}`,
      b < c ? `${b},${c}` : `${c},${b}`,
      c < a ? `${c},${a}` : `${a},${c}`
    ];
    for (let e = 0; e < 3; e++) {
      const faces = edgeToFaces.get(edges[e]) || [];
      neighbors[i * 3 + e] = faces.find(f => f !== i) ?? 0xFFFFFFFF;
    }
  }

  // ---- 6. Build dual mesh (hexagons/pentagons) ----
  // Each vertex of the subdivided icosahedron becomes a hex center
  // (except the 12 original vertices → pentagons)

  // Map vertex index -> list of adjacent face indices
  const vertexFaces = new Array(vertexCount).fill(0).map(() => [] as number[]);
  for (let i = 0; i < faceCount; i++) {
    vertexFaces[indices[i * 3]].push(i);
    vertexFaces[indices[i * 3 + 1]].push(i);
    vertexFaces[indices[i * 3 + 2]].push(i);
  }

  // Identify original 12 vertices (they have 5 adjacent faces, others have 6)
  const pentagonIndices: number[] = [];
  const hexCenterMap = new Map<number, number>(); // vertexIdx -> hexIdx

  for (let v = 0; v < vertexCount; v++) {
    const adj = vertexFaces[v];
    if (adj.length === 5) pentagonIndices.push(v);
    // Every vertex becomes a dual cell center
    hexCenterMap.set(v, hexCenterMap.size);
  }

  const hexCount = hexCenterMap.size;
  const hexCenters = new Float32Array(hexCount * 3);
  const hexNormals = new Float32Array(hexCount * 3);
  const hexNeighbors = new Uint32Array(hexCount * 6); // 6 max, pentagons use 5
  const hexTriangleIndices = new Uint32Array(hexCount * 6);
  const hexFaceCount = new Uint8Array(hexCount);

  // For each dual cell (hex/pent), collect its corner face centers in CCW order
  for (const [vertexIdx, hexIdx] of hexCenterMap) {
    const adjFaces = vertexFaces[vertexIdx];
    const count = adjFaces.length; // 5 or 6
    hexFaceCount[hexIdx] = count;

    // Sort faces CCW around vertex
    // Project face centers to tangent plane at vertex
    const vx = positions[vertexIdx * 3];
    const vy = positions[vertexIdx * 3 + 1];
    const vz = positions[vertexIdx * 3 + 2];

    // Build tangent basis
    const up = Math.abs(vx) > 0.1 ? [0, 1, 0] : [1, 0, 0];
    const tx = vy * up[2] - vz * up[1];
    const ty = vz * up[0] - vx * up[2];
    const tz = vx * up[1] - vy * up[0];
    const tlen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const ux = tx / tlen, uy = ty / tlen, uz = tz / tlen;
    const vx2 = vy * uz - vz * uy;
    const vy2 = vz * ux - vx * uz;
    const vz2 = vx * uy - vy * ux;

    const faceAngles = adjFaces.map(fIdx => {
      const fx = faceCenters[fIdx * 3];
      const fy = faceCenters[fIdx * 3 + 1];
      const fz = faceCenters[fIdx * 3 + 2];
      // Project to tangent plane
      const dx = fx - vx, dy = fy - vy, dz = fz - vz;
      const u = dx * ux + dy * uy + dz * uz;
      const v = dx * vx2 + dy * vy2 + dz * vz2;
      return { fIdx, angle: Math.atan2(v, u) };
    });
    faceAngles.sort((a, b) => a.angle - b.angle);

    // Store sorted face indices
    for (let k = 0; k < count; k++) {
      const fIdx = faceAngles[k].fIdx;
      hexTriangleIndices[hexIdx * 6 + k] = fIdx;
    }
    // Pad pentagons with 0xFFFFFFFF
    for (let k = count; k < 6; k++) {
      hexTriangleIndices[hexIdx * 6 + k] = 0xFFFFFFFF;
    }

    // Hex center = vertex position (already on sphere)
    hexCenters[hexIdx * 3] = vx;
    hexCenters[hexIdx * 3 + 1] = vy;
    hexCenters[hexIdx * 3 + 2] = vz;
    hexNormals[hexIdx * 3] = vx;
    hexNormals[hexIdx * 3 + 1] = vy;
    hexNormals[hexIdx * 3 + 2] = vz;
  }

  // ---- 7. Build hex neighbors ----
  // Two hexes are neighbors if they share an edge (i.e., their vertices share a face)
  for (const [vertexIdx, hexIdx] of hexCenterMap) {
    const adjFaces = vertexFaces[vertexIdx];
    // Each adjacent face connects to 2 other vertices of that face
    const neighborSet = new Set<number>();
    for (const fIdx of adjFaces) {
      const a = indices[fIdx * 3];
      const b = indices[fIdx * 3 + 1];
      const c = indices[fIdx * 3 + 2];
      const otherVertices = [a, b, c].filter(v => v !== vertexIdx);
      for (const otherV of otherVertices) {
        const otherHex = hexCenterMap.get(otherV);
        if (otherHex !== undefined && otherHex !== hexIdx) {
          neighborSet.add(otherHex);
        }
      }
    }
    const neighborsArr = Array.from(neighborSet);
    for (let k = 0; k < neighborsArr.length && k < 6; k++) {
      hexNeighbors[hexIdx * 6 + k] = neighborsArr[k];
    }
    // Pad with 0xFFFFFFFF
    for (let k = neighborsArr.length; k < 6; k++) {
      hexNeighbors[hexIdx * 6 + k] = 0xFFFFFFFF;
    }
  }

  // ---- 8. Classify land/sea for each hex ----
  let hexIsLand = new Uint8Array(hexCount);
  let hexBaseElevation: Float32Array | undefined;
  let faceElevation: Float32Array | undefined;
  let faceIsLand: Uint8Array | undefined;

  if (level === 6 && loadBaked) {
    // Try to load baked Earth data for level 6
    try {
      const response = await fetch('/earth-level6.json');
      if (response.ok) {
        const baked = await response.json();
        if (baked.hexCount === hexCount && baked.faceCount === faceCount) {
          hexIsLand = new Uint8Array(baked.hexIsLand);
          hexBaseElevation = new Float32Array(baked.hexBaseElevation);
          faceElevation = new Float32Array(baked.faceElevation);
          faceIsLand = new Uint8Array(baked.faceIsLand);
          console.log('[Icosphere] Loaded baked Earth data (level 6)');
        }
      }
    } catch (e) {
      console.warn('[Icosphere] Could not load baked Earth data:', e);
    }
  }

  // Fallback to procedural generation (if baked data not loaded)
  if (hexBaseElevation === undefined) {
    for (let i = 0; i < hexCount; i++) {
      const cx = hexCenters[i * 3];
      const cy = hexCenters[i * 3 + 1];
      const cz = hexCenters[i * 3 + 2];

      const n1 = fbm3({ x: cx * 2.0, y: cy * 2.0, z: cz * 2.0 }, 6);
      const n2 = fbm3({ x: cx * 4.0, y: cy * 4.0, z: cz * 4.0 }, 4);
      const n3 = fbm3({ x: cx * 8.0, y: cy * 8.0, z: cz * 8.0 }, 3);

      const combined = n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
      const latitudeBias = 1.0 - Math.abs(cy) * 0.3;
      const threshold = 0.35 * latitudeBias;
      hexIsLand[i] = combined > threshold ? 1 : 0;
    }
  }

  return {
    positions,
    indices,
    faceCenters,
    faceNormals,
    neighbors,
    hexCenters,
    hexNormals,
    hexNeighbors,
    hexTriangleIndices,
    hexFaceCount,
    hexIsLand,
    hexBaseElevation,
    faceElevation,
    faceIsLand,
    subdivisionLevel: level,
    vertexCount,
    faceCount,
    hexCount,
    pentagonIndices
  };
}

/**
 * Convert hex index to spherical UV for shader sampling
 */
export function hexToUV(hexCenter: Vec3): { u: number; v: number } {
  const { x, y, z } = hexCenter;
  const u = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
  const v = 0.5 + Math.asin(y) / Math.PI;
  return { u, v };
}

/**
 * Raycast from camera to sphere → hex index
 * Returns { hexIdx, point, normal } or null
 */
export function raycastHex(
  rayOrigin: Vec3,
  rayDir: Vec3,
  hexCenters: Float32Array,
  radius: number = 1
): { hexIdx: number; point: Vec3; normal: Vec3 } | null {
  // Sphere intersection
  const ocx = rayOrigin.x, ocy = rayOrigin.y, ocz = rayOrigin.z;
  const b = ocx * rayDir.x + ocy * rayDir.y + ocz * rayDir.z;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;

  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;

  const px = ocx + rayDir.x * t;
  const py = ocy + rayDir.y * t;
  const pz = ocz + rayDir.z * t;

  // Find closest hex center
  let bestIdx = -1;
  let bestDist = Infinity;
  const hexCount = hexCenters.length / 3;

  for (let i = 0; i < hexCount; i++) {
    const hx = hexCenters[i * 3];
    const hy = hexCenters[i * 3 + 1];
    const hz = hexCenters[i * 3 + 2];
    const dx = hx - px, dy = hy - py, dz = hz - pz;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) return null;

  return {
    hexIdx: bestIdx,
    point: { x: px, y: py, z: pz },
    normal: { x: px / radius, y: py / radius, z: pz / radius }
  };
}

export interface Vec3 {
  x: number; y: number; z: number;
}