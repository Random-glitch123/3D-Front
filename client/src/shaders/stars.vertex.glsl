// Stars vertex shader
// GLSL 300 ES

#version 300 es
precision highp float;

in vec3 position;
in vec3 color;

out vec3 vColor;

uniform mat4 viewProjection;

void main() {
  vColor = color;
  gl_Position = viewProjection * vec4(position, 1.0);
  gl_PointSize = 2.0;
}
