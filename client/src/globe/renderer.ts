// ============================================================================
// Globe Renderer
// Loads world-map.json and draws the hex-tiled Earth.
//
// * One merged mesh for every tile (ocean + land).
// * Flat per-tile shading (all vertices of a tile share the tile-centre normal).
// * Biome colours come from the JSON palette, baked into the shader.
// * Borders are drawn in the fragment shader from a per-vertex edge attribute,
//   so they can never z-fight or leave gaps.
// ============================================================================

import {
  Scene,
  Mesh,
  VertexData,
  ShaderMaterial,
  Color4,
  Vector3,
  Constants,
  Engine,
} from '@babylonjs/core';

export interface WorldMapData {
  meta: {
    name: string;
    subdivisions: number;
    radius: number;
    hexCount: number;
    cornerCount: number;
    triangleCount: number;
    biomeColors: Record<string, [number, number, number]>;
  };
  corners: number[];
  cornerHeights: number[];
  hexes: Array<{
    id: number;
    center: [number, number, number];
    corners: number[];
    neighbors: number[];
    biome: number;
    elevation: number;
    height: number;
  }>;
}

export interface GlobeRenderer {
  scene: Scene;
  landMesh: Mesh;
  dispose(): void;
  updateUniforms(cameraPos: Vector3, time: number): void;
  updateOwnership(ownershipColors: Float32Array, hexes: WorldMapData['hexes']): void;
}

function buildBiomeColorFunction(
  palette: Record<string, [number, number, number]>,
): string {
  const entries = Object.entries(palette)
    .map(([id, rgb]) => ({ id: Number(id), rgb }))
    .sort((a, b) => a.id - b.id);

  let glsl = 'vec3 biomeColor(float biome) {\n';
  for (const { id, rgb } of entries) {
    glsl += `  if (biome < ${(id + 0.5).toFixed(1)}) return vec3(${rgb[0].toFixed(4)}, ${rgb[1].toFixed(4)}, ${rgb[2].toFixed(4)});\n`;
  }
  glsl += '  return vec3(1.0, 0.0, 1.0);\n}';
  return glsl;
}

export async function createGlobeRenderer(
  radius: number = 100,
  engine: Engine,
): Promise<GlobeRenderer> {
  const response = await fetch('/world-map.json');
  if (!response.ok) {
    throw new Error(`Failed to load world-map.json: ${response.status}`);
  }
  const worldMap = (await response.json()) as WorldMapData;
  const { hexes, corners } = worldMap;

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.012, 0.016, 0.045, 1);
  scene.autoClear = true;

  // --------------------------------------------------------------------------
  // Build the merged tile mesh as PRISMS (top + bottom + side walls)
  // --------------------------------------------------------------------------
  // Each hex prism has:
  // - Top face: 1 center + N corners
  // - Bottom face: 1 center + N corners
  // - Side walls: N quads (2 tris each) with outward normals
  // Total vertices per hex: 6N + 2
  // Total indices per hex: 3*N (top) + 3*N (bottom) + 6*N (sides) = 12N

  // Precompute land proximity per hex for wave modulation.
  // coastal  = water hex directly bordering land
  // nearCoast = water hex within 2 hops of land (includes coastal)
  const isLand = hexes.map(h => h.biome >= 2);
  const coastal = new Uint8Array(hexes.length);
  const nearCoast = new Uint8Array(hexes.length);
  for (let i = 0; i < hexes.length; i++) {
    if (isLand[i]) continue;
    let isC = 0;
    let isN = 0;
    for (const nb of hexes[i].neighbors) {
      if (nb < 0 || nb >= hexes.length) continue;
      if (isLand[nb]) {
        isC = 1;
      } else if (!isN) {
        for (const nb2 of hexes[nb].neighbors) {
          if (nb2 >= 0 && nb2 < hexes.length && isLand[nb2]) {
            isN = 1;
            break;
          }
        }
      }
    }
    coastal[i] = isC;
    nearCoast[i] = isC || isN ? 1 : 0;
  }

  let vertexCount = 0;
  let indexCount = 0;
  for (let hi = 0; hi < hexes.length; hi++) {
    const n = hexes[hi].corners.length;
    vertexCount += 6 * n + 2;
    indexCount += 12 * n;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const biomeAttr = new Float32Array(vertexCount);
  const edgeAttr = new Float32Array(vertexCount);
  const coastalAttr = new Float32Array(vertexCount);
  const nearCoastAttr = new Float32Array(vertexCount);
  const ownershipAttr = new Float32Array(vertexCount * 3); // RGB per vertex
  const indices = new Uint32Array(indexCount);

  let v = 0;
  let idx = 0;

  const baseRadius = radius - 0.5; // Bottom of prism slightly below globe surface

  for (let hi = 0; hi < hexes.length; hi++) {
    const hex = hexes[hi];
    const cFlag = coastal[hi];
    const nFlag = nearCoast[hi];
    const [cx, cy, cz] = hex.center;
    const tileHeight = hex.height;
    const tileRadius = radius + tileHeight;
    const count = hex.corners.length;

    // ========== TOP FACE ==========
    const topCenterIdx = v;
    positions[v * 3] = cx * tileRadius;
    positions[v * 3 + 1] = cy * tileRadius;
    positions[v * 3 + 2] = cz * tileRadius;
    normals[v * 3] = cx;
    normals[v * 3 + 1] = cy;
    normals[v * 3 + 2] = cz;
    biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
    edgeAttr[v] = 1;
    v++;

    const topCornersStart = v;
    for (const cornerIndex of hex.corners) {
      const r = tileRadius;
      positions[v * 3] = corners[cornerIndex * 3] * r;
      positions[v * 3 + 1] = corners[cornerIndex * 3 + 1] * r;
      positions[v * 3 + 2] = corners[cornerIndex * 3 + 2] * r;
      normals[v * 3] = cx;
      normals[v * 3 + 1] = cy;
      normals[v * 3 + 2] = cz;
      biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
      edgeAttr[v] = 0;
      v++;
    }

    // Top face triangles (fan from center)
    for (let k = 0; k < count; k++) {
      indices[idx++] = topCenterIdx;
      indices[idx++] = topCornersStart + k;
      indices[idx++] = topCornersStart + ((k + 1) % count);
    }

    // ========== BOTTOM FACE ==========
    const bottomCenterIdx = v;
    positions[v * 3] = cx * baseRadius;
    positions[v * 3 + 1] = cy * baseRadius;
    positions[v * 3 + 2] = cz * baseRadius;
    normals[v * 3] = -cx;
    normals[v * 3 + 1] = -cy;
    normals[v * 3 + 2] = -cz;
    biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
    edgeAttr[v] = 1;
    v++;

    const bottomCornersStart = v;
    for (const cornerIndex of hex.corners) {
      const r = baseRadius;
      positions[v * 3] = corners[cornerIndex * 3] * r;
      positions[v * 3 + 1] = corners[cornerIndex * 3 + 1] * r;
      positions[v * 3 + 2] = corners[cornerIndex * 3 + 2] * r;
      normals[v * 3] = -cx;
      normals[v * 3 + 1] = -cy;
      normals[v * 3 + 2] = -cz;
      biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
      edgeAttr[v] = 0;
      v++;
    }

    // Bottom face triangles (fan from center, reversed winding for inward normal)
    for (let k = 0; k < count; k++) {
      indices[idx++] = bottomCenterIdx;
      indices[idx++] = bottomCornersStart + ((k + 1) % count);
      indices[idx++] = bottomCornersStart + k;
    }

    // ========== SIDE WALLS ==========
    // For each edge, create a quad (2 triangles) connecting top to bottom
    // Outward normal = edge direction × up (radial)
    for (let k = 0; k < count; k++) {
      const nextK = (k + 1) % count;

      // Top edge vertices
      const topA = topCornersStart + k;
      const topB = topCornersStart + nextK;

      // Bottom edge vertices
      const bottomA = bottomCornersStart + k;
      const bottomB = bottomCornersStart + nextK;

      // Compute outward normal for this side wall
      // Edge vector (topB - topA), radial = center of edge
      const ax = positions[topA * 3];
      const ay = positions[topA * 3 + 1];
      const az = positions[topA * 3 + 2];
      const bx = positions[topB * 3];
      const by = positions[topB * 3 + 1];
      const bz = positions[topB * 3 + 2];

      // Radial at edge midpoint (average of two corners)
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;
      const mz = (az + bz) * 0.5;
      const mlen = Math.hypot(mx, my, mz);
      const rx = mx / mlen;
      const ry = my / mlen;
      const rz = mz / mlen;

      // Outward normal = radial (points away from globe center)
      const nx = rx;
      const ny = ry;
      const nz = rz;

      // We need separate vertices for side walls with correct normals
      // Create 4 vertices for the quad (topA, topB, bottomB, bottomA) with side normals
      const sideStart = v;

      // Vertex 0: topA
      positions[v * 3] = ax;
      positions[v * 3 + 1] = ay;
      positions[v * 3 + 2] = az;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
      edgeAttr[v] = 0; // edge = 0 for sides
      v++;

      // Vertex 1: topB
      positions[v * 3] = bx;
      positions[v * 3 + 1] = by;
      positions[v * 3 + 2] = bz;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
      edgeAttr[v] = 0;
      v++;

      // Vertex 2: bottomB
      const bbx = positions[bottomB * 3];
      const bby = positions[bottomB * 3 + 1];
      const bbz = positions[bottomB * 3 + 2];
      positions[v * 3] = bbx;
      positions[v * 3 + 1] = bby;
      positions[v * 3 + 2] = bbz;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
      edgeAttr[v] = 0;
      v++;

      // Vertex 3: bottomA
      const bax = positions[bottomA * 3];
      const bay = positions[bottomA * 3 + 1];
      const baz = positions[bottomA * 3 + 2];
      positions[v * 3] = bax;
      positions[v * 3 + 1] = bay;
      positions[v * 3 + 2] = baz;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      biomeAttr[v] = hex.biome;
    coastalAttr[v] = cFlag;
    nearCoastAttr[v] = nFlag;
      edgeAttr[v] = 0;
      v++;

      // Two triangles for the quad (CCW from outside)
      indices[idx++] = sideStart;
      indices[idx++] = sideStart + 1;
      indices[idx++] = sideStart + 2;
      indices[idx++] = sideStart;
      indices[idx++] = sideStart + 2;
      indices[idx++] = sideStart + 3;
    }
  }

  const landMesh = new Mesh('landMesh', scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.indices = indices;
  vertexData.applyToMesh(landMesh, false);
  landMesh.setVerticesData('biome', biomeAttr, false, 1);
  landMesh.setVerticesData('edge', edgeAttr, false, 1);
  landMesh.setVerticesData('coastal', coastalAttr, false, 1);
  landMesh.setVerticesData('nearCoast', nearCoastAttr, false, 1);
  landMesh.setVerticesData('ownership', ownershipAttr, false, 3); // vec3
  landMesh.setVerticesData('territoryBorder', new Float32Array(vertexCount), false, 1);
  landMesh.alwaysSelectAsActiveMesh = true;

  // --------------------------------------------------------------------------
  // Tile shader
  // --------------------------------------------------------------------------
  const biomeColorFn = buildBiomeColorFunction(worldMap.meta.biomeColors);

  const tileVertexShader = `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in float biome;
in float edge;
in float coastal;
in float nearCoast;
in vec3 ownership; // RGB color of owner, 0,0,0 = unowned
in float territoryBorder; // 1 = owned hex on a territory edge

uniform mat4 viewProjection;
uniform vec3 cameraPosition;

out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vViewDir;
out float vBiome;
out float vEdge;
out float vCoastal;
out float vNearCoast;
out vec3 vOwnership;
out float vTerritoryBorder;

void main() {
  vWorldPos = position;
  vNormal = normalize(normal);
  vViewDir = normalize(cameraPosition - position);
  vBiome = biome;
  vEdge = edge;
  vCoastal = coastal;
  vNearCoast = nearCoast;
  vOwnership = ownership;
  vTerritoryBorder = territoryBorder;
  gl_Position = viewProjection * vec4(position, 1.0);
}
`;

  const tileFragmentShader = `#version 300 es
precision highp float;

uniform vec3 uSunDir;
uniform float uBorderWidth;
uniform float uTime;
uniform float uWaveStrength;
uniform float uWaveSpeed;

in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vViewDir;
in float vBiome;
in float vEdge;
in float vCoastal;
in float vNearCoast;
in vec3 vOwnership; // RGB color of owner, 0,0,0 = unowned
in float vTerritoryBorder;

out vec4 fragColor;

${biomeColorFn}

// Ownership tint opacity (25%)
#define OWNERSHIP_TINT_OPACITY 0.45

#define TAU 6.28318530718

// ---- 3D value noise (continuous across tile borders) ----
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

// FBM noise for natural variation
float fbm(vec3 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < octaves; i++) {
    value += amplitude * vnoise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// ---- Stable rotation-invariant wave direction on sphere ----
// Returns a tangent direction that varies continuously across the sphere,
// derived from spherical coordinates (no pole singularity).
vec3 waveDirection(vec3 pos) {
  // Spherical coordinates from world position
  float lon = atan(pos.z, pos.x);          // [-PI, PI]
  float lat = asin(clamp(pos.y, -1.0, 1.0)); // [-PI/2, PI/2]

  // Primary wave direction: flows along latitude lines (east-west)
  vec3 east = normalize(cross(pos, vec3(0.0, 1.0, 0.0)));
  vec3 north = normalize(cross(east, pos));
  
  // Blend between east-west and diagonal flow based on latitude
  // Near poles: more diagonal; equator: more east-west
  float latWeight = cos(lat);
  return normalize(east * latWeight + north * (1.0 - latWeight) * 0.3);
}

// Directional sine wave with noise-modulated frequency for natural variation
// Returns phase [-1, 1] based on world position (continuous across hexes)
float dirWave(vec3 pos, vec3 dir, float baseWavelength, float speed, float time) {
  // Noise-modulated wavelength: varies spatially across the ocean
  float noiseScale = 0.008;
  float wavelengthVariation = fbm(pos * noiseScale + vec3(0.0, time * 0.02, 0.0), 3);
  float wavelength = baseWavelength * mix(0.85, 1.15, wavelengthVariation * 0.5 + 0.5);
  
  float k = TAU / wavelength;
  float omega = speed * uWaveSpeed * time;
  float phase = k * dot(dir, pos) - omega;
  return sin(phase);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDir);

  float biome = vBiome;
  float coastal = vCoastal;
  float nearCoast = vNearCoast;
  float isOcean = step(biome, 0.5); // biome 0 = ocean -> 1.0, >= 2 = land -> 0.0
  float isLand = 1.0 - isOcean;

  vec3 base = biomeColor(biome);

  // Soft, mostly-flat lighting so every tile reads as a solid colour.
  float ndl = max(dot(N, L), 0.0);
  float light = 0.62 + 0.55 * ndl;
  vec3 color = base * light;

  // Ownership tint (25% opacity) - only for land tiles
  if (isLand > 0.5 && length(vOwnership) > 0.0) {
    color = mix(color, vOwnership, OWNERSHIP_TINT_OPACITY);
  }

  // Thin atmospheric rim at the silhouette.
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  color += vec3(0.18, 0.38, 0.68) * rim * 0.55;

  // Wave crest lines (delicate cyan/white) and trough shading
  if (isOcean > 0.5) {
    // Land proximity: gentle modulation, no bright coastal flashing
    // Range 0.6 (open) -> 0.9 (coastal) — subtle difference
    float proximity = mix(0.6, 0.9, mix(coastal, nearCoast, coastal));
    // Cap proximity to prevent any flash
    proximity = min(proximity, 0.9);
    
    // Stable wave direction (no pole cuts) - continuous across globe
    vec3 waveDir1 = waveDirection(vWorldPos);
    
    // Secondary direction: perpendicular, slightly rotated by noise for natural variation
    vec3 perp = cross(N, normalize(cross(waveDir1, N)));
    float dirNoise = fbm(vWorldPos * 0.015 + vec3(uTime * 0.01, 0.0, 0.0), 2);
    float dirAngle = dirNoise * 0.6; // ±0.6 rad rotation
    vec3 waveDir2 = normalize(waveDir1 * cos(dirAngle) + perp * sin(dirAngle));
    
    // Tertiary direction: diagonal, for interference pattern
    vec3 waveDir3 = normalize(waveDir1 + perp) * 0.7071;

    // Three wave layers with noise-modulated wavelengths
    float swell   = dirWave(vWorldPos, waveDir1, 42.0, 0.85, uTime) * 0.55;
    float chop    = dirWave(vWorldPos, waveDir2, 16.0, 1.35, uTime) * 0.3;
    float crossCh = dirWave(vWorldPos, waveDir3, 24.0, 1.1, uTime) * 0.2;
    
    float combined = swell + chop + crossCh;
    
    // Phase-based crest detection — thinner, delicate bell curve
    float phase = abs(combined);
    float crest = smoothstep(0.6, 0.8, phase) * smoothstep(0.8, 0.6, phase);
    crest = pow(crest, 1.1) * proximity * uWaveStrength * 0.35;
    
    // Trough shading: very subtle darker blue between crests
    float trough = smoothstep(0.25, 0.6, phase) * (1.0 - crest);
    trough *= proximity * uWaveStrength * 0.15;
    
    // Crest color: cyan/light-blue, not bright white
    vec3 crestColor = mix(vec3(0.3, 0.7, 0.9), vec3(0.6, 0.9, 1.0), smoothstep(0.0, 1.0, ndl));
    color += crestColor * crest;
    color -= vec3(0.04, 0.08, 0.14) * trough;
    
    // Subtle sun glint on forward-facing crests
    float glint = pow(max(dot(N, normalize(L + V)), 0.0), 20.0) * crest * 0.4;
    color += vec3(0.5, 0.8, 1.0) * glint;

    // Subtle base ocean texture (faint noise) so open ocean never looks empty
    float baseNoise = vnoise(vWorldPos * 0.04 + vec3(uTime * 0.008, 0.0, 0.0)) * 0.5;
    color += vec3(0.02, 0.04, 0.06) * baseNoise * proximity * 0.5;
  }

  // Tile borders. Screen-space width, capped so zoomed-out tiles stay clean.
  // Owned hexes on a territory edge get a thicker black outline.
  float aa = max(fwidth(vEdge), 1e-5);
  float widthScale = mix(1.0, 2.6, vTerritoryBorder);
  float bw = min(uBorderWidth * widthScale, widthScale * aa);
  float border = 1.0 - smoothstep(bw - aa, bw + aa, vEdge);
  color = mix(color, vec3(0.015, 0.025, 0.04), border);

  fragColor = vec4(color, 1.0);
}
`;

  const tileMaterial = new ShaderMaterial(
    'tileMaterial',
    scene,
    { vertexSource: tileVertexShader, fragmentSource: tileFragmentShader },
    {
      attributes: ['position', 'normal', 'biome', 'edge', 'coastal', 'nearCoast', 'ownership', 'territoryBorder'],
      uniforms: ['viewProjection', 'cameraPosition', 'uSunDir', 'uBorderWidth', 'uTime', 'uWaveStrength', 'uWaveSpeed'],
      uniformBuffers: ['SceneUniforms'],
      needAlphaBlending: false,
      needAlphaTesting: false,
    },
  );

  tileMaterial.setVector3('uSunDir', new Vector3(0.8, 0.45, 0.55).normalize());
  tileMaterial.setFloat('uBorderWidth', 0.16);
  tileMaterial.setFloat('uWaveStrength', 0.45);
  tileMaterial.setFloat('uWaveSpeed', 1.0);
  tileMaterial.backFaceCulling = false;
  tileMaterial.forceDepthWrite = true;
  landMesh.material = tileMaterial;

  // --------------------------------------------------------------------------
  // Starfield
  // --------------------------------------------------------------------------
  const starCount = 2200;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = radius * 20 + Math.random() * radius * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi);
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const tint = 0.75 + Math.random() * 0.25;
    starColors[i * 3] = tint;
    starColors[i * 3 + 1] = tint;
    starColors[i * 3 + 2] = Math.min(1, tint + Math.random() * 0.15);
  }

  const starsMesh = new Mesh('starsMesh', scene);
  const starVertexData = new VertexData();
  starVertexData.positions = starPositions;
  starVertexData.colors = starColors;
  starVertexData.applyToMesh(starsMesh, false);

  const starVertexShader = `#version 300 es
precision highp float;
in vec3 position;
in vec3 color;
out vec3 vColor;
uniform mat4 viewProjection;
void main() {
  vColor = color;
  gl_Position = viewProjection * vec4(position, 1.0);
  gl_PointSize = 1.5;
}
`;

  const starFragmentShader = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}
`;

  const starMaterial = new ShaderMaterial(
    'starMaterial',
    scene,
    { vertexSource: starVertexShader, fragmentSource: starFragmentShader },
    {
      attributes: ['position', 'color'],
      uniforms: ['viewProjection'],
      uniformBuffers: ['SceneUniforms'],
      needAlphaBlending: true,
      needAlphaTesting: false,
    },
  );
  starMaterial.forceDepthWrite = false;
  starMaterial.alphaMode = Constants.ALPHA_ADD;
  starMaterial.pointsCloud = true;
  starsMesh.material = starMaterial;
  starsMesh.alwaysSelectAsActiveMesh = true;

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------
  function dispose() {
    landMesh.dispose();
    tileMaterial.dispose();
    starsMesh.dispose();
    starMaterial.dispose();
    scene.dispose();
  }

  function updateUniforms(_cameraPos: Vector3, time: number) {
    // Scene uniforms (camera position) are updated automatically by Babylon.
    tileMaterial.setFloat('uTime', time);
  }

  function updateOwnership(ownershipColors: Float32Array, hexes: WorldMapData['hexes']) {
    // ownershipColors: Float32Array of length hexCount * 3 (RGB per hex, 0,0,0 = unowned)
    // hexes: array of hex data with corners array for each hex
    // We need to expand per-hex colors to per-vertex colors.

    const vertexCount = landMesh.getTotalVertices();
    const ownershipBuffer = new Float32Array(vertexCount * 3);
    const territoryBuffer = new Float32Array(vertexCount);

    let v = 0;
    for (let hi = 0; hi < hexes.length; hi++) {
      const hex = hexes[hi];
      const count = hex.corners.length;
      const vertsPerHex = 6 * count + 2; // top center + top corners + bottom center + bottom corners + side walls

      // Get hex color (3 floats)
      const r = ownershipColors[hi * 3];
      const g = ownershipColors[hi * 3 + 1];
      const b = ownershipColors[hi * 3 + 2];

      // A territory edge = owned hex touching a hex with a different owner
      // (including unowned land). Draw those outlines thicker in the shader.
      let isTerritoryBorder = 0;
      if (r + g + b > 0) {
        for (const neighborId of hex.neighbors) {
          if (neighborId < 0 || neighborId >= hexes.length) continue;
          const nr = ownershipColors[neighborId * 3];
          const ng = ownershipColors[neighborId * 3 + 1];
          const nb = ownershipColors[neighborId * 3 + 2];
          if (Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb) > 0.02) {
            isTerritoryBorder = 1;
            break;
          }
        }
      }

      // Fill ownership + border flag for all vertices of this hex
      for (let i = 0; i < vertsPerHex; i++) {
        ownershipBuffer[v * 3] = r;
        ownershipBuffer[v * 3 + 1] = g;
        ownershipBuffer[v * 3 + 2] = b;
        territoryBuffer[v] = isTerritoryBorder;
        v++;
      }
    }

    landMesh.setVerticesData('ownership', ownershipBuffer, false, 3);
    landMesh.setVerticesData('territoryBorder', territoryBuffer, false, 1);
  }

  return {
    scene,
    landMesh,
    dispose,
    updateUniforms,
    updateOwnership,
  };
}
