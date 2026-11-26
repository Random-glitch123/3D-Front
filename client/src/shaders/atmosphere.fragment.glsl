// Atmosphere fragment shader: Rayleigh/Mie scattering
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

// Varyings
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vViewDir;
in vec3 vSunDir;

out vec4 fragColor;

#define PI 3.14159265359

// Ray-sphere intersection
float intersectSphere(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float c = dot(origin, origin) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b - sqrt(disc);
}

// Optical depth approximation (Sean O'Neil)
float opticalDepth(float altitude, float scaleHeight) {
  return exp(-altitude / scaleHeight);
}

void main() {
  vec3 cameraPos = uCameraPos;
  float cameraAlt = length(cameraPos) - uRadius;
  
  vec3 viewDir = vViewDir;
  
  // Entry point into atmosphere
  float tEntry = intersectSphere(cameraPos, viewDir, uAtmosphereRadius);
  if (tEntry < 0.0) discard;
  
  // Exit point
  float tExit = intersectSphere(vWorldPos, -viewDir, uRadius);
  if (tExit < 0.0) {
    tExit = intersectSphere(cameraPos, viewDir, uRadius);
  }
  if (tExit < 0.0) {
    tExit = uAtmosphereRadius * 2.0;
  }
  
  // Sample along ray
  const int SAMPLES = 16;
  float totalDensity = 0.0;
  float scaleHeight = uAtmosphereRadius / uDensity;
  
  for (int i = 0; i < SAMPLES; i++) {
    float t = float(i) / float(SAMPLES - 1);
    vec3 samplePos = cameraPos + viewDir * (tEntry + t * (tExit - tEntry));
    float altitude = length(samplePos) - uRadius;
    float density = opticalDepth(max(0.0, altitude), scaleHeight);
    totalDensity += density;
  }
  
  totalDensity *= (tExit - tEntry) / float(SAMPLES);
  
  // Scattering color (Rayleigh: blue scatters more)
  vec3 scatterColor = uColor;
  vec3 extinctionColor = vec3(1.0, 0.6, 0.3); // Warm extinction
  
  // Phase function (Rayleigh)
  float cosTheta = dot(vViewDir, vSunDir);
  float phase = 0.75 * (1.0 + cosTheta * cosTheta);
  
  // Mie scattering (aerosols) - forward peaked
  float g = 0.8;
  float miePhase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
  
  // Combine
  vec3 color = scatterColor * totalDensity * phase * 20.0;
  color += extinctionColor * totalDensity * 5.0;
  color += vec3(miePhase) * totalDensity * 0.1;
  
  // Fresnel boost at limb
  float fresnel = pow(1.0 - max(0.0, dot(vViewDir, vNormal)), 2.0);
  color *= 1.0 + fresnel * 3.0;
  
  // Alpha
  float alpha = 1.0 - exp(-totalDensity * 5.0);
  alpha *= fresnel;
  
  // Fade near camera
  if (cameraAlt < uAtmosphereRadius - uRadius) {
    alpha *= smoothstep(0.0, uAtmosphereRadius - uRadius, cameraAlt);
  }
  
  fragColor = vec4(color, alpha);
}