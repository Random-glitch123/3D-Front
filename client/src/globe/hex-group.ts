// Hexagon grouping and instance data preparation for ThinInstance
// Takes icosphere dual mesh data and creates per-hex instance matrices
// Pure TypeScript, no renderer dependency — outputs plain arrays

import type { IcosphereData } from './icosahedron';

export interface HexInstanceData {
  // Per-instance data for ThinInstance (column-major 4x4 matrix = 16 floats)
  matrix: Float32Array;
  hexId: number;
  // For shader: which face indices belong to this hex (6 max)
  faceIndices: number[]; // padded with -1
  faceCount: number;     // 5 or 6
  // Neighbors for pathfinding/game logic
  neighbors: number[];   // padded with -1
  // Land/sea classification
  isLand: boolean;
  // True for water hexes adjacent to land (for shoreline foam)
  isCoastal: boolean;
}

/**
 * Build instance data for all hexagons/pentagons
 * Each hex gets a Matrix4 (Float32Array[16], column-major) positioning it on the sphere
 */
export function buildHexInstances(
  icosphere: IcosphereData,
  radius: number = 1
): HexInstanceData[] {
  const { hexCenters, hexNeighbors, hexFaceCount, hexTriangleIndices, hexCount, hexIsLand } = icosphere;
  const instances: HexInstanceData[] = [];

  // Reusable arrays for vector math (avoid allocation in loop)
  const up = [0, 1, 0];
  const forward = [0, 0, 0];
  const right = [0, 0, 0];
  const position = [0, 0, 0];
  const quaternion = [0, 0, 0, 1]; // x, y, z, w
  const scale = [1, 1, 1];
  const matrix = new Float32Array(16);

  for (let i = 0; i < hexCount; i++) {
    // Hex center position (on sphere)
    const cx = hexCenters[i * 3];
    const cy = hexCenters[i * 3 + 1];
    const cz = hexCenters[i * 3 + 2];

    position[0] = cx * radius;
    position[1] = cy * radius;
    position[2] = cz * radius;

    // Normal = outward from sphere center (already normalized since hexCenters on unit sphere)
    forward[0] = cx;
    forward[1] = cy;
    forward[2] = cz;

    // Choose up vector that's not parallel to forward
    let upX = up[0], upY = up[1], upZ = up[2];
    const dot = forward[0] * upX + forward[1] * upY + forward[2] * upZ;
    if (Math.abs(dot) > 0.99) {
      upX = 1; upY = 0; upZ = 0; // At poles, use X as up
    }

    // Right = up × forward
    right[0] = upY * forward[2] - upZ * forward[1];
    right[1] = upZ * forward[0] - upX * forward[2];
    right[2] = upX * forward[1] - upY * forward[0];
    let rlen = Math.sqrt(right[0] * right[0] + right[1] * right[1] + right[2] * right[2]);
    right[0] /= rlen; right[1] /= rlen; right[2] /= rlen;

    // Recompute up = forward × right (ensures orthonormal)
    upX = forward[1] * right[2] - forward[2] * right[1];
    upY = forward[2] * right[0] - forward[0] * right[2];
    upZ = forward[0] * right[1] - forward[1] * right[0];
    const ulen = Math.sqrt(upX * upX + upY * upY + upZ * upZ);
    upX /= ulen; upY /= ulen; upZ /= ulen;

    // Quaternion from basis vectors (right, up, forward)
    // Using matrix-to-quaternion conversion
    const m00 = right[0], m01 = upX, m02 = forward[0];
    const m10 = right[1], m11 = upY, m12 = forward[1];
    const m20 = right[2], m21 = upZ, m22 = forward[2];

    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      quaternion[3] = 0.25 / s;
      quaternion[0] = (m21 - m12) * s;
      quaternion[1] = (m02 - m20) * s;
      quaternion[2] = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
      quaternion[3] = (m21 - m12) / s;
      quaternion[0] = 0.25 * s;
      quaternion[1] = (m01 + m10) / s;
      quaternion[2] = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
      quaternion[3] = (m02 - m20) / s;
      quaternion[0] = (m01 + m10) / s;
      quaternion[1] = 0.25 * s;
      quaternion[2] = (m12 + m21) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
      quaternion[3] = (m10 - m01) / s;
      quaternion[0] = (m02 + m20) / s;
      quaternion[1] = (m12 + m21) / s;
      quaternion[2] = 0.25 * s;
    }

    // Compose matrix: T * R * S (column-major for Babylon.js/Three.js compatibility)
    // Matrix elements (column-major):
    // [ m00, m10, m20, m30,
    //   m01, m11, m21, m31,
    //   m02, m12, m22, m32,
    //   m03, m13, m23, m33 ]
    const x = quaternion[0], y = quaternion[1], z = quaternion[2], w = quaternion[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    // Rotation matrix (3x3)
    const r00 = 1 - (yy + zz);
    const r01 = xy - wz;
    const r02 = xz + wy;
    const r10 = xy + wz;
    const r11 = 1 - (xx + zz);
    const r12 = yz - wx;
    const r20 = xz - wy;
    const r21 = yz + wx;
    const r22 = 1 - (xx + yy);

    // Apply scale
    const sx = scale[0], sy = scale[1], sz = scale[2];

    // Column-major 4x4 matrix
    matrix[0]  = r00 * sx; matrix[4] = r01 * sy; matrix[8]  = r02 * sz; matrix[12] = position[0];
    matrix[1]  = r10 * sx; matrix[5] = r11 * sy; matrix[9]  = r12 * sz; matrix[13] = position[1];
    matrix[2]  = r20 * sx; matrix[6] = r21 * sy; matrix[10] = r22 * sz; matrix[14] = position[2];
    matrix[3]  = 0;        matrix[7] = 0;        matrix[11] = 0;        matrix[15] = 1;

    // Face indices (6 max, padded with -1)
    const fCount = hexFaceCount[i];
    const faceIndices: number[] = [];
    for (let k = 0; k < 6; k++) {
      const idx = hexTriangleIndices[i * 6 + k];
      faceIndices.push(idx === 0xFFFFFFFF ? -1 : idx);
    }

    // Neighbors (6 max, padded with -1)
    const neighbors: number[] = [];
    for (let k = 0; k < 6; k++) {
      const idx = hexNeighbors[i * 6 + k];
      neighbors.push(idx === 0xFFFFFFFF ? -1 : idx);
    }

    instances.push({
      matrix: new Float32Array(matrix), // Clone
      hexId: i,
      faceIndices,
      faceCount: fCount,
      neighbors,
      isLand: hexIsLand[i] === 1,
      isCoastal: false // Will be computed in second pass
    });
  }

  // Second pass: mark water hexes adjacent to land as coastal
  for (let i = 0; i < hexCount; i++) {
    if (!instances[i].isLand) {
      // Check if any neighbor is land
      for (const neighborIdx of instances[i].neighbors) {
        if (neighborIdx >= 0 && instances[neighborIdx].isLand) {
          instances[i].isCoastal = true;
          break;
        }
      }
    }
  }

  return instances;
}

/** Merged dual-cell mesh data, ready for Babylon.js VertexData */
export interface GlobeGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Water only: 1 for tiles touching land, 0 for open ocean */
  coastal?: Float32Array;
  /** 1 on vertices that sit on the land/water boundary (shared by both meshes) */
  shore: Float32Array;
  /** Biome index per vertex (0=ocean,1=beach,2=grassland,3=forest,4=desert,5=tundra,6=snow,7=rock,8=ice) */
  biome: Float32Array;
}

const TAU = Math.PI * 2;

/**
 * Build one merged mesh out of the exact dual-mesh tiles.
 *
 * Every tile corner is an icosphere face center. Neighbouring tiles share those
 * face centers, so their polygons meet edge-to-edge exactly — no gaps and no
 * overlaps anywhere on the globe (unlike a fixed-size instanced hexagon).
 */
export function buildGlobeGeometry(
  icosphere: IcosphereData,
  radius: number = 1,
  isLand: boolean = false
): GlobeGeometryData {
  const {
    indices: triangleIndices,
    faceCount,
    hexCenters,
    hexTriangleIndices,
    hexFaceCount,
    hexNeighbors,
    hexCount,
    hexIsLand,
    faceCenters,
    faceElevation,
    faceIsLand
  } = icosphere;

  // Shore flags are per triangle (shared by all tiles using that corner), so
  // land and water resolve identical displacement exactly at the coastline.
  // (hex index === vertex index in the dual mesh)
  const faceShore = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const a = triangleIndices[f * 3];
    const b = triangleIndices[f * 3 + 1];
    const c = triangleIndices[f * 3 + 2];
    const landSum = hexIsLand[a] + hexIsLand[b] + hexIsLand[c];
    faceShore[f] = landSum > 0 && landSum < 3 ? 1 : 0;
  }

  // Coastal flag for water tiles adjacent to land
  const coastalFlags = new Uint8Array(hexCount);
  if (!isLand) {
    for (let i = 0; i < hexCount; i++) {
      if (hexIsLand[i] === 1) continue;
      for (let k = 0; k < 6; k++) {
        const nb = hexNeighbors[i * 6 + k];
        if (nb !== 0xFFFFFFFF && hexIsLand[nb] === 1) {
          coastalFlags[i] = 1;
          break;
        }
      }
    }
  }

  // Count vertices/indices (center + corners per tile)
  let vertexCount = 0;
  let indexCount = 0;
  for (let i = 0; i < hexCount; i++) {
    if ((hexIsLand[i] === 1) !== isLand) continue;
    const corners = hexFaceCount[i];
    vertexCount += 1 + corners;
    indexCount += corners * 3;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  const coastal = isLand ? undefined : new Float32Array(vertexCount);
  const shore = new Float32Array(vertexCount);
  const biome = new Float32Array(vertexCount);

  // Helper: classify biome from latitude, elevation, moisture, shore
  function classifyBiome(
    lat: number,      // -90 to 90
    elev: number,     // meters
    moist: number,    // 0-1 moisture
    isShore: number   // 0 or 1
  ): number {
    const absLat = Math.abs(lat);

    // Permanent ice caps (poles)
    if (absLat > 82.0) return 8; // ICE

    // Water
    if (elev <= 0) return 0; // OCEAN

    // Beach: low elevation near coast
    if (elev < 30 && isShore === 1) return 1; // BEACH

    // High elevation rock (above tree line)
    if (elev > 4000) return 7; // ROCK

    // Snow: cold high elevation
    if (absLat > 60 && elev > 1500) return 6; // SNOW

    // Tundra: cold low-mid elevation
    if (absLat > 60 && elev <= 1500) return 5; // TUNDRA

    // Desert belt: ~20-35° latitude, low moisture
    if (absLat > 15 && absLat < 35 && moist < 0.35) return 4; // DESERT

    // Forest: high moisture, mid/high elevation
    if (moist > 0.55 && elev > 200) return 3; // FOREST

    // Grassland: everything else on land
    return 2; // GRASSLAND
  }

  let v = 0;
  let idx = 0;

  for (let i = 0; i < hexCount; i++) {
    if ((hexIsLand[i] === 1) !== isLand) continue;
    const corners = hexFaceCount[i];
    const center = v;
    const cFlag = coastal ? coastalFlags[i] : 0;

    // Tile center (on the sphere)
    const cx = hexCenters[i * 3];
    const cy = hexCenters[i * 3 + 1];
    const cz = hexCenters[i * 3 + 2];

    positions[v * 3] = cx * radius;
    positions[v * 3 + 1] = cy * radius;
    positions[v * 3 + 2] = cz * radius;

    // Radial normal (smooth across tiles)
    normals[v * 3] = cx;
    normals[v * 3 + 1] = cy;
    normals[v * 3 + 2] = cz;

    uvs[v * 2] = 0.5 + Math.atan2(cz, cx) / TAU;
    uvs[v * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, cy))) / Math.PI;

    if (coastal) coastal[v] = cFlag;

    // Biome for tile center
    const latC = Math.asin(Math.max(-1, Math.min(1, cy))) * 180 / Math.PI;
    const elevC = faceElevation ? (faceElevation[i] || 0) : 0;
    const moistC = moistureAt(latC, hexIsLand[i] === 1);
    biome[v] = classifyBiome(latC, elevC, moistC, isLand ? cFlag : 0);
    v++;

    // Corners: the shared face centers of the adjacent triangles
    const firstCorner = v;
    for (let k = 0; k < corners; k++) {
      const face = hexTriangleIndices[i * 6 + k];
      const fx = faceCenters[face * 3];
      const fy = faceCenters[face * 3 + 1];
      const fz = faceCenters[face * 3 + 2];

      positions[v * 3] = fx * radius;
      positions[v * 3 + 1] = fy * radius;
      positions[v * 3 + 2] = fz * radius;

      normals[v * 3] = fx;
      normals[v * 3 + 1] = fy;
      normals[v * 3 + 2] = fz;

      uvs[v * 2] = 0.5 + Math.atan2(fz, fx) / TAU;
      uvs[v * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, fy))) / Math.PI;

      if (coastal) coastal[v] = cFlag;
      shore[v] = faceShore[face];

      // Biome for corner vertex
      const latK = Math.asin(Math.max(-1, Math.min(1, fy))) * 180 / Math.PI;
      const elevK = faceElevation ? (faceElevation[face] || 0) : 0;
      const moistK = moistureAt(latK, faceIsLand ? (faceIsLand[face] || 0) === 1 : false);
      biome[v] = classifyBiome(latK, elevK, moistK, shore[v]);
      v++;
    }

    // Triangle fan from the center
    for (let k = 0; k < corners; k++) {
      indices[idx++] = center;
      indices[idx++] = firstCorner + k;
      indices[idx++] = firstCorner + ((k + 1) % corners);
    }
  }

  return { positions, normals, uvs, indices, coastal, shore, biome };
}

/** Moisture by latitude band (Earth-like climate pattern) */
function moistureAt(lat: number, isLand: boolean): number {
  const absLat = Math.abs(lat);
  let moist = 0.5;

  // Equatorial rainforest band (wet)
  if (absLat < 10) moist = 0.85;
  // Subtropical dry zone (~20-30°)
  else if (absLat > 15 && absLat < 35) moist = 0.25;
  // Mid-latitudes (moderate)
  else if (absLat > 35 && absLat < 60) moist = 0.55;
  // High latitudes (variable, often moist near coasts)
  else moist = 0.6;

  // Continental interiors are drier
  if (isLand && absLat > 20 && absLat < 60) moist *= 0.8;

  return Math.max(0, Math.min(1, moist));
}

/** Border geometry data for line rendering */
export interface BorderGeometryData {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Create border geometry — line segments along every tile edge.
 * Uses the same shared face centers as tile corners, so borders exactly
 * trace the tile boundaries without gaps or overlaps.
 */
export function createBorderGeometry(
  icosphere: IcosphereData,
  radius: number = 1
): BorderGeometryData {
  const { hexTriangleIndices, hexFaceCount, hexCount, faceCenters } = icosphere;

  // Collect unique edges (each edge = pair of face centers)
  // Use a set of "faceA,faceB" where faceA < faceB
  const edgeSet = new Set<string>();

  for (let i = 0; i < hexCount; i++) {
    const corners = hexFaceCount[i];
    for (let k = 0; k < corners; k++) {
      const faceA = hexTriangleIndices[i * 6 + k];
      const faceB = hexTriangleIndices[i * 6 + ((k + 1) % corners)];
      if (faceA === 0xFFFFFFFF || faceB === 0xFFFFFFFF) continue;
      const a = Math.min(faceA, faceB);
      const b = Math.max(faceA, faceB);
      edgeSet.add(`${a},${b}`);
    }
  }

  const edges = Array.from(edgeSet).map(s => {
    const [a, b] = s.split(',').map(Number);
    return { a, b };
  });

  const vertexCount = edges.length * 2;
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(edges.length * 2);

  for (let i = 0; i < edges.length; i++) {
    const { a, b } = edges[i];

    // Face center A
    positions[i * 6] = faceCenters[a * 3] * radius;
    positions[i * 6 + 1] = faceCenters[a * 3 + 1] * radius;
    positions[i * 6 + 2] = faceCenters[a * 3 + 2] * radius;

    // Face center B
    positions[i * 6 + 3] = faceCenters[b * 3] * radius;
    positions[i * 6 + 4] = faceCenters[b * 3 + 1] * radius;
    positions[i * 6 + 5] = faceCenters[b * 3 + 2] * radius;

    // Line segment indices
    indices[i * 2] = i * 2;
    indices[i * 2 + 1] = i * 2 + 1;
  }

  return { positions, indices };
}

/**
 * Create hexagon geometry data (flat hexagon centered at origin, facing +Z)
 * Returns plain arrays for Babylon.js vertex buffer creation
 */
export interface HexGeometryData {
  positions: Float32Array; // 7 vertices × 3 (center + 6 corners)
  uvs: Float32Array;       // 7 vertices × 2
  indices: Uint16Array | Uint32Array;    // 18 indices (6 triangles × 3)
}

export function createHexGeometry(radius: number = 1): HexGeometryData {
  const vertexCount = 7; // Center + 6 corners
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  // Center vertex
  positions[0] = 0; positions[1] = 0; positions[2] = 0;
  uvs[0] = 0.5; uvs[1] = 0.5;

  // 6 corners (flat-top hexagon)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 6; // Start at flat top
    const idx = (i + 1) * 3;
    positions[idx] = Math.cos(angle) * radius;
    positions[idx + 1] = Math.sin(angle) * radius;
    positions[idx + 2] = 0;

    const uvIdx = (i + 1) * 2;
    uvs[uvIdx] = 0.5 + Math.cos(angle) * 0.5;
    uvs[uvIdx + 1] = 0.5 + Math.sin(angle) * 0.5;
  }

  // Indices for triangle fan (center + 6 corners)
  // Use Uint16Array since we only have 7 vertices (max index = 6)
  const indices = new Uint16Array([
    0, 1, 2,   0, 2, 3,   0, 3, 4,   0, 4, 5,   0, 5, 6,   0, 6, 1
  ]);

  return { positions, uvs, indices };
}

/**
 * Create a curved hexagon geometry using the actual triangle faces
 * More accurate but more complex — each hex has different triangle count
 * For now, use flat hex + vertex shader displacement
 */
export function createCurvedHexGeometry(
  _icosphere: IcosphereData,
  _hexId: number
): HexGeometryData {
  return createHexGeometry(0.95); // Slightly smaller than sphere radius
}