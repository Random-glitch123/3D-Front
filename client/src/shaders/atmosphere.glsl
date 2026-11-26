// Atmosphere vertex shader: Fresnel glow + Rayleigh scattering
// GLSL 300 ES

#version 300 es
precision highp float;

// Uniforms
uniform float uRadius;
uniform float uAtmosphereRadius;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uDensity;

// Scene uniforms (Babylon.js built-in)
uniform mat4 viewProjection;
uniform mat4 view;
uniform mat4 projection;
uniform vec3 cameraPosition;

// Attributes
in vec3 position;
in vec2 uv;

// Varyings
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vViewDir;
out vec3 vSunDir;

void main() {
  // Atmosphere is a single sphere, not instanced
  vec3 worldPos = position; // Sphere vertices are already in world space (radius = uAtmosphereRadius)
  vec3 normal = normalize(position); // Sphere normal = position
  
  vWorldPos = worldPos;
  vNormal = normal;
  vViewDir = normalize(uCameraPos - worldPos);
  vSunDir = uSunDir;
  
  gl_Position = viewProjection * vec4(worldPos, 1.0);
}