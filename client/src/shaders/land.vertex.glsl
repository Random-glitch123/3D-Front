// Land vertex shader — smooth terrain with softened coastlines
// GLSL 300 ES - Babylon.js auto-transpiles to WGSL for WebGPU

#version 300 es
precision highp float;

// Uniforms
uniform float uTime;
uniform float uRadius;
uniform vec3 uSunDir;

// Scene uniforms (Babylon.js built-in)
uniform mat4 viewProjection;
uniform vec3 cameraPosition;

// Attributes (merged globe geometry)
in vec3 position;   // world-space vertex on the globe (face center = shared vertex)
in vec3 normal;     // radial outward normal
in vec2 uv;
in float shore;     // 1 on boundary vertices shared with water
in float biome;     // biome index per vertex

// Varyings
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vViewDir;
out vec2 vUv;
out float vElevation;
out float vBiome;

// ---- Smooth 3D value noise ----
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

float fbm3(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * vnoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

// Deterministic "baked" elevation from large-scale noise
float bakedElevation(vec3 worldPos) {
  // Continental scale (~250km) - smoothest
  float n1 = fbm3(worldPos * 0.004);
  // Regional scale (~80km)
  float n2 = fbm3(worldPos * 0.012);
  // Local scale (~25km) - subtle
  float n3 = fbm3(worldPos * 0.04);

  // Combine with heavier weight on smooth continental scale
  float elev = n1 * 0.7 + n2 * 0.25 + n3 * 0.05;

  // Latitude bias
  float lat = asin(clamp(worldPos.y / length(worldPos), -1.0, 1.0));
  float absLat = abs(lat) * 180.0 / 3.14159;
  if (absLat > 50.0) elev += 0.08;
  if (absLat > 30.0 && absLat < 50.0) elev += 0.04;

  // Major mountain belts (subtle)
  float lon = atan(worldPos.z, worldPos.x) * 180.0 / 3.14159;
  if (absLat > 30.0 && absLat < 50.0) {
    if ((lon > -125.0 && lon < -100.0) ||  // Rockies
        (lon > -10.0 && lon < 20.0) ||     // Alps/Urals
        (lon > 70.0 && lon < 100.0) ||     // Himalayas
        (lon > -80.0 && lon < -65.0)) {    // Andes
      elev += 0.08;
    }
  }

  // Scale to meters (max ~900m) then to world units
  return elev * 900.0;
}

void main() {
  vec3 n = normalize(normal);

  // Base elevation from deterministic function
  float baseElev = bakedElevation(position);

  // Very subtle detail noise
  float detail = (fbm3(position * 0.03) - 0.5) * 100.0;

  // Total height before shore attenuation
  float height = baseElev + detail;

  // Soft shore transition: fade elevation to 0 near coast
  // shore = 1 at coast, 0 inland. Use smoothstep for gradual fade.
  float shoreFade = smoothstep(1.0, 0.0, shore);
  height *= shoreFade;

  // Convert to world units (radius = 100, so meters/100 = world units)
  float worldHeight = height / 100.0;

  vec3 displaced = position + n * worldHeight;

  gl_Position = viewProjection * vec4(displaced, 1.0);

  vWorldPos = displaced;
  vNormal = n;
  vViewDir = normalize(cameraPosition - displaced);
  vUv = uv;
  vElevation = height;
  vBiome = biome;
}
