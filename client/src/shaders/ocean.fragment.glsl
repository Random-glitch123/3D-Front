// Ocean fragment shader — clean water shading with sun glint and coastal foam
// GLSL 300 ES

#version 300 es
precision highp float;

// Uniforms
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uWaterColor;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;

// Varyings
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vViewDir;
in float vCrest;
in float vCoastal;

out vec4 fragColor;

// ---- Smooth 3D value noise (continuous across tile borders) ----
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

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDir);

  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 0.0);

  // Schlick fresnel: ~2% looking straight down, bright at the limb
  float fresnel = pow(1.0 - ndv, 5.0);
  fresnel = mix(0.02, 1.0, fresnel);

  // Sun glint
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 128.0) * ndl;

  // Water body colour: lighter near coastlines, deep blue in open ocean
  float coastal = clamp(vCoastal, 0.0, 1.0);
  vec3 base = mix(uDeepColor, uShallowColor, 0.20 + 0.55 * coastal);
  base = mix(base, uWaterColor, 0.35);

  vec3 color = base * (0.55 + 0.55 * ndl);
  color += vec3(0.10, 0.22, 0.40) * fresnel * 0.90;
  color += vec3(1.00, 0.96, 0.88) * spec * 1.40;

  // Foam on wave crests near the coast only
  float crest = smoothstep(0.58, 0.80, vCrest);
  float foamNoise = vnoise(vWorldPos * 0.25 + vec3(0.0, uTime * 0.15, 0.0));
  float foam = coastal * crest * smoothstep(0.35, 0.75, foamNoise);
  foam *= smoothstep(0.05, 0.35, ndl);
  color = mix(color, uFoamColor, foam * 0.65);

  fragColor = vec4(color, 1.0);
}
