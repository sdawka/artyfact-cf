// GLSL for the Orb. Two draws per frame and no offscreen targets:
//  1. `glow`: one full-canvas pass for the rim filaments, flares, halo, spark arcs and the interior haze, worked out in
//     polar coordinates around the orb centre (units of the orb radius R, y up).
//  2. `dust`: one point per particle. Positions are derived in the vertex shader from per-particle seeds, the eased
//     fill and motion weights, and a handful of uniform impulses (pointer stirs and pulse kicks), so the dust is
//     stateless: nothing is simulated or read back.

export const MAX_SPARKS = 8;
export const MAX_STIRS = 6;

const common = `
const float PI = 3.14159265;
const float TAU = 6.28318531;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(41.37, 289.11))) * 23758.5453);
}

// Smooth value noise in 0..1.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Noise sampled around a circle, so it is seamless in the angle. freq sets features per turn, drift animates it.
float ringNoise(float angle, float freq, vec2 drift) {
  return vnoise(vec2(cos(angle), sin(angle)) * freq + drift);
}

// Shortest signed angle from b to a.
float angleDelta(float a, float b) {
  return mod(a - b + PI, TAU) - PI;
}
`;

export const glowVertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const glowFragment = `#version 300 es
precision highp float;

uniform vec2 uCanvas;    // canvas size, device px
uniform vec2 uCenter;    // orb centre, device px (bottom-left origin)
uniform float uRadius;   // R, device px
uniform float uLine;     // filament half-width, R units
uniform float uFeather;  // canvas edge fade width, device px
uniform float uReach;    // room between the rim and the nearest canvas edge, R units
uniform float uTime;
uniform float uStrands;
uniform float uCrackle;
uniform float uFlares;
uniform float uGlow;
uniform float uHaze;
uniform float uFill;
uniform float uIntro;
uniform float uSurge;
uniform vec2 uHeat;      // angle (radians), amount 0..1
uniform float uLight;    // 1 for the light theme (ink on paper)
uniform vec4 uSparks[${MAX_SPARKS * 2}];
uniform vec3 uRimColor;
uniform vec3 uHotColor;
uniform vec3 uHaloColor;
uniform vec3 uHazeColor;
uniform vec3 uSparkColor;

out vec4 fragColor;
${common}

// One filament of the rim: a ring at radius ~1 that wobbles radially. Returns brightness.
float filament(float r, float a, float i, float t, float amp, float jitter) {
  float ph = i * 1.931 + 0.37;
  float slow = ringNoise(a, 2.3, vec2(t * 0.31 + ph, ph * 0.71 - t * 0.23)) - 0.5;
  float mid = ringNoise(a, 5.5, vec2(ph * 1.37 - t * 0.57, t * 0.47 + ph)) - 0.5;
  float fine = ringNoise(a, 26.0, vec2(t * 3.7 + ph * 2.1, ph - t * 2.9)) - 0.5;
  float off = amp * (slow * 1.7 + mid * 0.8) + fine * jitter;
  float d = r - (1.0 + off);
  float w = uLine;
  return exp(-d * d / (w * w)) + 0.22 * exp(-abs(d) / (w * 3.5));
}

void main() {
  vec2 p = (gl_FragCoord.xy - uCenter) / uRadius;
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = uTime;

  // Hover heat: a warm patch on the rim around the pointer angle.
  float heatD = angleDelta(a, uHeat.x);
  float heat = uHeat.y * exp(-heatD * heatD / 0.16);

  // Intro: the rim draws in from the bottom up both sides, the halo blooms with a brief extra charge.
  float fromBottom = acos(clamp(-p.y / max(r, 1e-4), -1.0, 1.0)) / PI; // 0 at the bottom, 1 at the top
  float draw = smoothstep(0.0, 0.6, uIntro) * 1.1;
  float drawn = clamp((draw - fromBottom) / 0.07, 0.0, 1.0);
  float front = uIntro < 0.62 ? exp(-pow((fromBottom - draw + 0.03) / 0.05, 2.0)) : 0.0;
  float charge = sin(PI * clamp((uIntro - 0.3) / 0.6, 0.0, 1.0));
  float bloom = smoothstep(0.25, 0.85, uIntro) + 0.6 * charge;

  float crackle = clamp(uCrackle + heat * 0.6 + charge * 0.5, 0.0, 1.6);
  float topDim = 1.0 - 0.3 * smoothstep(0.05, 1.0, p.y / max(r, 1e-4));

  // Rim filaments (only near the rim).
  float rim = 0.0;
  if (abs(r - 1.0) < 0.16) {
    float amp = 0.006 + 0.024 * crackle + 0.012 * uSurge;
    float jitter = 0.022 * crackle * crackle + 0.006 * uSurge;
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      if (fi >= uStrands) break;
      rim += clamp(uStrands - fi, 0.0, 1.0) * filament(r, a, fi, t * (1.0 + 0.6 * crackle), amp, jitter);
    }
    rim *= 1.9 / (1.0 + 0.45 * uStrands);
  }
  rim *= topDim * (1.0 + heat * 1.3 + uSurge * 0.9) * drawn + front * 1.5 * step(abs(r - 1.0), 0.05) * exp(-pow((r - 1.0) / 0.02, 2.0));

  // Flares: slow outward tongues of glow along the rim; heat raises them locally.
  float tongue = smoothstep(0.48, 0.92, ringNoise(a, 1.8, vec2(t * 0.11, 3.1 - t * 0.08)));
  float fl = clamp(tongue * uFlares + heat * 0.35 + uSurge * 0.25 * uFlares, 0.0, 1.4);
  float reach = 0.035 + 0.2 * fl;
  float wisp = 0.55 + 0.45 * ringNoise(a, 11.0, vec2(t * 0.9 - r * 7.0, 1.7));
  // Everything outside the rim fades out before the canvas edge, so the canvas never shows as a box.
  float room = smoothstep(uReach, uReach * 0.35, max(r - 1.0, 0.0));
  float flare = r > 1.0 ? exp(-(r - 1.0) / reach) * wisp * room : exp(-(1.0 - r) / 0.025);
  flare *= fl * 0.55 * topDim * drawn;

  // Halo: tight bloom around the rim plus a wide soft falloff.
  float out_ = max(r - 1.0, 0.0);
  float halo = r > 1.0 ? (0.42 * exp(-out_ / 0.06) + 0.14 * exp(-out_ / 0.22)) * room : 0.3 * exp(-(1.0 - r) / 0.045);
  halo *= uGlow * bloom * topDim * (0.6 + 0.4 * drawn) * (1.0 + 0.6 * uSurge + 0.5 * heat);

  // Sparks: short tapered arcs just inside the rim, each crackling along a jagged path.
  float spark = 0.0;
  for (int j = 0; j < ${MAX_SPARKS}; j++) {
    vec4 s = uSparks[j * 2];      // angle, half-length (radians), radius, bend
    vec4 m = uSparks[j * 2 + 1];  // progress 0..1, seed, brightness, direction
    if (m.x <= 0.0 || m.x >= 1.0) continue;
    float x = angleDelta(a, s.x) / s.y;
    if (abs(x) >= 1.0) continue;
    float head = mix(-1.0, 1.25, min(1.0, m.x * 3.2));
    float shown = smoothstep(head + 0.02, head - 0.12, x * m.w);
    float fade = (1.0 - m.x) * (1.0 - m.x);
    float jag = (vnoise(vec2(x * 9.0 + m.y * 17.0, m.x * 14.0)) - 0.5) * 0.026 + (vnoise(vec2(x * 23.0 - m.y * 5.0, m.x * 31.0)) - 0.5) * 0.012;
    float path = s.z - s.w * (1.0 - x * x) + jag;
    float d = r - path;
    float w = uLine * 0.85;
    float taper = pow(1.0 - x * x, 1.3);
    spark += taper * shown * fade * m.z * (exp(-d * d / (w * w)) + 0.28 * exp(-abs(d) / (w * 5.0)));
  }

  // Interior haze pool low in the ball, sized by fill, and a faint shading along the inside of the glass.
  float inside = smoothstep(1.0, 0.965, r);
  float cy = -0.72 + 0.42 * uFill;
  vec2 q = vec2(p.x / 0.82, (p.y - cy) / (0.2 + 0.38 * uFill));
  float reveal = smoothstep(0.2, 0.9, uIntro);
  float pool = exp(-dot(q, q) * 1.3) * 0.26 * uHaze * reveal;
  float edge = exp(-(1.0 - r) / 0.08) * 0.1 * uHaze * (0.5 + 0.5 * reveal);
  // A soft reflection on the upper left of the glass.
  vec2 dir = p / max(r, 1e-4);
  float sheen = exp(-pow((r - 0.87) / 0.035, 2.0)) * smoothstep(0.55, 1.0, dot(dir, vec2(-0.6, 0.8))) * 0.06 * reveal;
  float interior = (pool + edge) * inside;

  // Fade out at the canvas edge so wide halos never show a hard cut.
  vec2 fc = gl_FragCoord.xy;
  float edgeFade = smoothstep(0.0, uFeather, min(min(fc.x, uCanvas.x - fc.x), min(fc.y, uCanvas.y - fc.y)));

  vec3 col = uRimColor * rim * 0.95 + uHotColor * rim * rim * 0.35
    + uHaloColor * (halo + flare)
    + uHazeColor * interior + uHotColor * sheen
    + uSparkColor * spark * 1.5;
  float weight = rim + rim * rim * 0.35 + halo + flare + interior + sheen + spark * 1.5;

  float grain = (hash21(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  if (uLight > 0.5) {
    // Ink: the average tone, with coverage from the total energy.
    vec3 ink = col / max(weight, 1e-4);
    float alpha = clamp(1.0 - exp(-weight * 1.1), 0.0, 0.94) * edgeFade;
    fragColor = vec4(ink * alpha, alpha);
  } else {
    col = 1.0 - exp(-col * 1.15);
    col += grain * step(0.004, weight);
    col = max(col, 0.0) * edgeFade;
    fragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
  }
}
`;

export const dustVertex = `#version 300 es
precision highp float;

in vec4 aPlace;   // height, azimuth, radial seeds; tone index
in vec4 aMotion;  // phase, rate, size seed; kind (0 sediment, 1 shell, 2 outlier)

uniform vec2 uCanvas;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uPointScale;
uniform float uGain;
uniform float uTime;
uniform float uFill;
uniform vec4 uMotionMix;  // rise, fall, drift, orbit weights
uniform float uTwinkle;
uniform float uDepth;
uniform vec2 uRotation;   // yaw, pitch
uniform float uIntro;
uniform float uSurge;
uniform vec4 uKick;       // direction xy, age (s), strength
uniform vec4 uStirs[${MAX_STIRS * 2}];
uniform vec3 uTones[5];

out vec3 vColor;
out float vAlpha;
out float vSize;

const float PI = 3.14159265;
const float TAU = 6.28318531;

vec2 rotate2(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
  float kind = aMotion.w;
  float phase = aMotion.x;
  float rate = 0.6 + 0.8 * aMotion.y;
  float az = aPlace.y * TAU;
  float surface = mix(-0.85, 0.72, uFill);
  vec3 pos;
  float alpha;
  if (kind < 0.5) {
    // Sediment: denser at the bottom, the settled surface softening into the space above.
    float y = -1.0 + (surface + 1.2) * pow(aPlace.x, 1.3);
    float slice = sqrt(max(0.0, 1.0 - y * y));
    float rad = slice * sqrt(aPlace.z) * 0.96;
    pos = vec3(rad * cos(az), y, rad * sin(az));
    alpha = 0.8 * smoothstep(surface + 0.2, surface - 0.15, y);
  } else if (kind < 1.5) {
    // Shell: hugging the inside of the glass, thinning out with height.
    float y = min(0.97, -1.0 + (surface + 1.4) * pow(aPlace.x, 1.15));
    float slice = sqrt(max(0.0, 1.0 - y * y));
    float rad = slice * (0.93 + 0.05 * aPlace.z);
    pos = vec3(rad * cos(az), y, rad * sin(az));
    alpha = 0.95 * smoothstep(surface + 0.45, surface - 0.1, y);
  } else {
    // Outliers: sparse and pale, anywhere in the ball.
    float y = aPlace.x * 2.0 - 1.0;
    float ring = sqrt(max(0.0, 1.0 - y * y));
    float rad = pow(aPlace.z, 0.333) * 0.94;
    pos = rad * vec3(ring * cos(az), y, ring * sin(az));
    alpha = 0.75;
  }

  // Motion. Each mode is an offset and an alpha factor; the eased weights crossfade between modes.
  float t = uTime;
  float cycle = fract(t * 0.055 * rate + phase);
  bool mover = aMotion.y > 0.62 || kind > 1.5;
  vec3 wobble = vec3(sin(t * 0.7 * rate + phase * 31.0), sin(t * 0.53 * rate + phase * 17.0), cos(t * 0.61 * rate + phase * 23.0));
  vec3 rise = vec3(0.025 * wobble.x, cycle * 0.5, 0.025 * wobble.z);
  float riseA = smoothstep(0.0, 0.12, cycle) * (1.0 - smoothstep(0.45, 1.0, cycle));
  vec3 fall = vec3(0.025 * wobble.x, (1.0 - cycle) * 0.5, 0.025 * wobble.z);
  float fallA = smoothstep(0.0, 0.3, cycle) * (1.0 - smoothstep(0.88, 1.0, cycle));
  if (!mover) {
    rise = vec3(0.008 * wobble);
    fall = rise;
    riseA = 1.0;
    fallA = 1.0;
  }
  vec3 drift = 0.05 * wobble;
  float loopR = 0.03 + 0.045 * aPlace.z;
  float la = t * 0.85 * rate + phase * TAU;
  float tiltA = phase * 9.0;
  vec3 orbit = loopR * vec3(cos(la), sin(la) * cos(tiltA), sin(la) * sin(tiltA));
  vec3 offset = uMotionMix.x * rise + uMotionMix.y * fall + uMotionMix.z * drift + uMotionMix.w * orbit;
  alpha *= uMotionMix.x * riseA + uMotionMix.y * fallA + uMotionMix.z + uMotionMix.w;
  pos += offset;
  float len = length(pos);
  if (len > 0.975) pos *= 0.975 / len;

  // Sway and pointer tilt: rotate the cloud (yaw about the vertical axis, then a little pitch).
  pos.xz = rotate2(pos.xz, uRotation.x);
  pos.yz = rotate2(pos.yz, uRotation.y);
  vec2 sp = pos.xy;

  // Pointer stirs: a swirl around each stir point plus a drag along its motion, springing back as it ages.
  float stirred = 0.0;
  for (int k = 0; k < ${MAX_STIRS}; k++) {
    vec4 s = uStirs[k * 2];       // position xy, velocity xy (R units / s)
    vec4 m = uStirs[k * 2 + 1];   // age (s), strength, spin direction
    if (m.y <= 0.0) continue;
    vec2 d = sp - s.xy;
    float fall_ = exp(-dot(d, d) / 0.16);
    float env = (1.0 - exp(-m.x * 9.0)) * exp(-m.x * 1.1) * m.y * fall_;
    vec2 swirled = rotate2(d, m.z * env * 0.7) - d;
    sp += swirled + s.zw * 0.025 * env;
    stirred += env;
  }

  // Pulse kick: an outward push, strongest toward the pulse direction, that springs back.
  float kenv = (1.0 - exp(-uKick.z * 16.0)) * exp(-uKick.z * 2.4) * uKick.w;
  vec2 outward = sp / max(length(sp), 1e-3);
  float toward = length(uKick.xy) > 0.0 ? 0.55 + 0.45 * dot(outward, uKick.xy) : 1.0;
  sp += outward * kenv * 0.085 * toward * length(sp);
  float sl = length(sp);
  if (sl > 0.985) sp *= 0.985 / sl;

  // Intro: reveal from the bottom up.
  float revealY = -1.15 + 2.5 * smoothstep(0.15, 1.0, uIntro);
  alpha *= smoothstep(revealY, revealY - 0.25, sp.y);

  // Depth: far particles smaller and dimmer.
  float near = pos.z * 0.5 + 0.5;
  float depthK = mix(1.0, 0.25 + 0.85 * near, uDepth);
  float sizeK = mix(1.0, 0.55 + 0.6 * near, uDepth);

  // Twinkle: occasional bright blinks.
  float tw = 0.5 + 0.5 * sin(t * (1.3 + 3.2 * aMotion.y) + phase * 57.0);
  tw = tw * tw * tw;
  float twinkle = mix(1.0, 0.3 + 1.6 * tw, uTwinkle);

  float bright = alpha * depthK * twinkle * uGain * (1.0 + 0.6 * uSurge + 0.8 * min(stirred, 1.0) + 0.6 * kenv);
  int tone = int(aPlace.w + 0.5);
  vColor = uTones[tone];
  vAlpha = bright * (kind > 1.5 ? 1.2 : 1.0);

  float size = (0.8 + 1.7 * aMotion.z + (kind > 1.5 ? 0.4 : 0.0)) * sizeK * uPointScale;
  vSize = size;
  gl_PointSize = size + 1.0;
  vec2 px = uCenter + sp * uRadius;
  vec2 clip = px / uCanvas * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const dustFragment = `#version 300 es
precision highp float;
uniform float uRound;
uniform float uLight;
in vec3 vColor;
in float vAlpha;
in float vSize;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cover;
  if (uRound > 0.5) {
    float d = length(c) * 2.0;
    float feather = 2.0 / (vSize + 1.0);
    cover = 1.0 - smoothstep(1.0 - feather, 1.0, d);
  } else {
    // Square grain: a crisp box the size of the particle inside the padded point sprite.
    vec2 e = abs(c) * (vSize + 1.0);
    vec2 box = 1.0 - smoothstep(vec2(vSize * 0.5 - 0.5), vec2(vSize * 0.5 + 0.5), e);
    cover = box.x * box.y;
  }
  float a = clamp(vAlpha, 0.0, 1.0) * cover;
  if (a <= 0.002) discard;
  if (uLight > 0.5) {
    a *= 0.85;
    fragColor = vec4(vColor * a, a);
  } else {
    vec3 col = vColor * a;
    fragColor = vec4(col, max(col.r, max(col.g, col.b)));
  }
}
`;
