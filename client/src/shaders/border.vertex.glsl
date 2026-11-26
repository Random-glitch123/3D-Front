// Border vertex shader — thin lines along tile edges
// GLSL 300 ES

#version 300 es
precision highp float;

in vec3 position;

uniform mat4 viewProjection;
uniform float uBorderWidth;

out float vWidth;

void main() {
  vWidth = uBorderWidth;
  gl_Position = viewProjection * vec4(position, 1.0);
}