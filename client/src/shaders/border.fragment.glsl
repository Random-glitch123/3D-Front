// Border fragment shader — thin black lines around each hexagon
// GLSL 300 ES

#version 300 es
precision highp float;

uniform vec3 uBorderColor;
uniform float uBorderAlpha;

out vec4 fragColor;

void main() {
  fragColor = vec4(uBorderColor, uBorderAlpha);
}
