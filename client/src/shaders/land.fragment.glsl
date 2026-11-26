// Land fragment shader — biome-based coloring (NASA Earth style)
// GLSL 300 ES

#version 300 es
precision highp float;

// Uniforms
uniform float uTime;
uniform float uRadius;
uniform vec3 uSunDir;

// Varyings
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vViewDir;
in vec2 vUv;
in float vElevation;
in float vBiome;

out vec4 fragColor;

// ---- Smooth 3D value noise (continuous in world space) ----
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

// Biome color palette (NASA Earth from space style)
// 0=OCEAN, 1=BEACH, 2=GRASSLAND, 3=FOREST, 4=DESERT, 5=TUNDRA, 6=SNOW, 7=ROCK, 8=ICE
vec3 biomeColor(float biome) {
  if (biome < 0.5)      return vec3(0.02, 0.08, 0.18);   // OCEAN - deep blue
  else if (biome < 1.5) return vec3(0.94, 0.82, 0.60);   // BEACH - sand
  else if (biome < 2.5) return vec3(0.34, 0.58, 0.26);   // GRASSLAND - green
  else if (biome < 3.5) return vec3(0.18, 0.42, 0.16);   // FOREST - dark green
  else if (biome < 4.5) return vec3(0.88, 0.78, 0.55);   // DESERT - tan
  else if (biome < 5.5) return vec3(0.70, 0.78, 0.65);   // TUNDRA - pale green
  else if (biome < 6.5) return vec3(0.92, 0.94, 0.96);   // SNOW - white
  else if (biome < 7.5) return vec3(0.55, 0.55, 0.52);   // ROCK - gray
  else                  return vec3(0.95, 0.96, 0.98);   // ICE - bright white
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDir);

  // Base color from biome
  vec3 baseColor = biomeColor(vBiome);

  // Add subtle noise variation within each biome
  float variation = fbm3(vWorldPos * 0.09);
  baseColor = mix(baseColor, baseColor * vec3(0.92, 1.0, 0.92), variation * 0.12);

  // Ambient + diffuse
  float ndl = max(dot(N, L), 0.0);
  vec3 color = baseColor * (0.30 + 0.85 * ndl);

  // Specular highlight on snow/ice
  float snowFactor = smoothstep(6.0, 8.5, vBiome);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 32.0) * ndl * snowFactor;
  color += vec3(1.0, 0.98, 0.95) * spec * 0.8;

  // Subtle rim light
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  color += vec3(0.15, 0.25, 0.35) * rim * 0.2;

  // Atmosphere fog
  float fogFactor = smoothstep(50.0, 200.0, length(vWorldPos));
  color = mix(color, vec3(0.4, 0.5, 0.6), fogFactor * 0.25);

  fragColor = vec4(color, 1.0);
}
