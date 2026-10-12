// GLSL for AmbientField: one cheap full-screen haze pass plus a few thousand stateless drifting points.
// No offscreen targets and no simulation, so the cost is one fill-rate pass at DPR <= 1 plus the points.

export const MAX_RIPPLES = 4;

const rippleChunk = `
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform float uRippleSpeed;
uniform float uRippleLife;

// Ring of a ripple at CSS-px point p: x,y centre (px), z age (s), w strength. Returns 0..1.
float ripple(vec4 r, vec2 p, float width) {
  if (r.w <= 0.0 || r.z >= uRippleLife) return 0.0;
  float radius = r.z * uRippleSpeed;
  float d = length(p - r.xy) - radius;
  float fade = 1.0 - r.z / uRippleLife;
  return exp(-d * d / (width * width)) * r.w * fade * fade;
}
`;

export const hazeVertex = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const hazeFragment = `#version 300 es
precision highp float;

uniform vec2 uSize;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform vec2 uParallax;
${rippleChunk}
in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  float aspect = uSize.x / max(uSize.y, 1.0);
  // Haze pool: a wide soft ellipse low in the frame that breathes slowly and leans away from the pointer.
  vec2 q = vUv - vec2(0.5 - uParallax.x * 0.04, -0.08 - uParallax.y * 0.03);
  q.x *= mix(1.0, aspect, 0.55);
  float breathe = 0.85 + 0.15 * sin(uTime * 0.21);
  float pool = exp(-dot(q, q) * 3.2) * breathe;
  // Faint upper veil so the top of the page is not flat.
  vec2 v = vUv - vec2(0.78 + uParallax.x * 0.02, 1.05);
  v.x *= aspect * 0.6;
  float veil = exp(-dot(v, v) * 5.0) * (0.9 + 0.1 * sin(uTime * 0.13 + 1.7));
  float ring = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) ring += ripple(uRipples[i], px, 18.0 + 24.0 * uRipples[i].z);
  float light = (pool * 0.5 + veil * 0.18) * uIntensity + ring * 0.35 * (0.4 + 0.6 * uIntensity);
  // Dither against banding in the very dark ramp.
  light += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * (1.5 / 255.0);
  vec3 col = uColor * max(light, 0.0);
  fragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}
`;

export const motesVertex = `#version 300 es
precision highp float;

in vec4 aSeed;

uniform vec2 uSize;
uniform float uDpr;
uniform float uTime;
uniform float uIntensity;
uniform vec2 uParallax;
uniform vec3 uColor;
${rippleChunk}
out vec3 vColor;
out float vSize;

void main() {
  float depth = aSeed.z;
  float t = uTime * (0.4 + 0.6 * depth);
  // Slow upward drift with a sideways sway; positions wrap so the field never empties.
  vec2 home = aSeed.xy + vec2(0.012 * sin(t * 0.31 + aSeed.w * 6.2831), t * 0.006);
  vec2 uv = fract(home);
  vec2 p = uv * uSize;
  p += uParallax * (8.0 + 36.0 * depth) * vec2(-1.0, 1.0);
  // Ripples push motes outward as the ring passes.
  vec2 push = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float k = ripple(r, p, 40.0);
    vec2 dir = p - r.xy;
    push += normalize(dir + 1e-4) * k * 18.0;
  }
  p += push;
  vec2 clip = p / uSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float size = (1.2 + 2.2 * depth * depth) * uDpr;
  gl_PointSize = size + 1.5;
  vSize = size;
  float twinkle = 0.65 + 0.35 * sin(uTime * (0.6 + 1.4 * aSeed.w) + aSeed.w * 40.0);
  // Fade at the top and bottom edges where positions wrap.
  float edge = smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.92, uv.y);
  float lift = length(push) * 0.04;
  vColor = uColor * (0.35 + 0.75 * depth + lift) * twinkle * edge * uIntensity;
}
`;

export const motesFragment = `#version 300 es
precision highp float;
in vec3 vColor;
in float vSize;
out vec4 fragColor;
void main() {
  // Soft disc: full inside, a roughly one-pixel feather at the rim.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float feather = 2.0 / (vSize + 1.5);
  float cover = 1.0 - smoothstep(1.0 - feather, 1.0, d);
  if (cover <= 0.001) discard;
  vec3 col = vColor * cover;
  fragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}
`;
