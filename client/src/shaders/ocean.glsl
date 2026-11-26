// Ocean surface shader — gentle swells on a sphere, continuous over tiles
// GLSL 300 ES - Babylon.js auto-transpiles to WGSL for WebGPU

#version 300 es
precision highp float;

// Uniforms
uniform float uTime;
uniform float uRadius;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform vec3 uSunDir;

// Scene uniforms (Babylon.js built-in)
uniform mat4 viewProjection;
uniform vec3 cameraPosition;

// Attributes (merged globe geometry)
in vec3 position;   // world-space vertex on the globe
in vec3 normal;     // radial outward normal
in float coastal;   // 1 = tile touches land, 0 = open ocean
in float shore;     // 1 on boundary vertices shared with land (anchor to sea level)

// Varyings
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vViewDir;
out float vCrest;
out float vCoastal;

#define TAU 6.28318530718

// Add one wave as a smooth 3D plane wave. The phase uses the full direction
// (continuous everywhere), while displacement/normal use its tangent projection
// (which smoothly vanishes where the wave vector is radial).
void addWave(
  vec3 p, vec3 n, vec3 t, vec3 b, vec3 dirHint,
  float amplitude, float wavelength, float speed,
  inout float height, inout vec2 slope, inout vec2 horizontal
) {
  vec3 dir = normalize(dirHint);
  vec3 tangentDir = dir - n * dot(n, dir);

  float k = TAU / wavelength;
  float omega = sqrt(9.81 * k) * speed * uWaveSpeed;
  float phase = k * dot(dir, p) - omega * uTime;
  float s = sin(phase);
  float c = cos(phase);

  float amp = amplitude * uWaveScale;
  vec2 tangentDir2 = vec2(dot(tangentDir, t), dot(tangentDir, b));

  height += amp * s;
  slope += amp * k * c * tangentDir2;
  horizontal += amp * c * tangentDir2;
}

void main() {
  // Tangent frame on the sphere
  vec3 n = normalize(normal);
  vec3 upRef = abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(cross(upRef, n));
  vec3 b = cross(n, t);

  float height = 0.0;
  vec2 slope = vec2(0.0);
  vec2 horizontal = vec2(0.0);

  // Long, gentle ocean swells (total amplitude ~0.4 world units)
  addWave(position, n, t, b, normalize(vec3( 0.90,  0.25,  0.45)), 0.150, 52.0, 1.00, height, slope, horizontal);
  addWave(position, n, t, b, normalize(vec3(-0.55,  0.35,  0.85)), 0.100, 37.0, 1.15, height, slope, horizontal);
  addWave(position, n, t, b, normalize(vec3(-0.95,  0.15, -0.35)), 0.070, 29.0, 0.90, height, slope, horizontal);
  addWave(position, n, t, b, normalize(vec3( 0.30, -0.20, -0.95)), 0.045, 23.0, 1.25, height, slope, horizontal);

  // Short ripples (long enough that the tiles resolve them smoothly)
  addWave(position, n, t, b, normalize(vec3( 0.70,  0.50, -0.60)), 0.028, 18.0, 1.50, height, slope, horizontal);
  addWave(position, n, t, b, normalize(vec3(-0.25, -0.45,  0.75)), 0.018, 14.0, 1.80, height, slope, horizontal);

  // Fade displacement out at the shoreline so water meets land exactly
  float attenuate = 1.0 - shore;

  // Radial displacement + a tiny tangential drift (keeps shared tile edges welded)
  vec3 displaced = position + n * (height * attenuate)
                 + (t * horizontal.x + b * horizontal.y) * (0.35 * attenuate);

  // Analytic wave normal in world space
  vec3 waveNormal = normalize(n - (t * slope.x + b * slope.y) * attenuate);

  gl_Position = viewProjection * vec4(displaced, 1.0);

  vWorldPos = displaced;
  vNormal = waveNormal;
  vViewDir = normalize(cameraPosition - displaced);
  vCrest = clamp(height / 0.4 * 0.5 + 0.5, 0.0, 1.0);
  vCoastal = coastal;
}
