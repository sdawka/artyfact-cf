/*
 * Adapted from the Crystalized Ball component in React Bits (https://github.com/DavidHDev/react-bits).
 * Copyright (c) 2026 David Haz. Licensed under MIT + Commons Clause License Condition v1.0, NOT Apache-2.0:
 * use inside an application, website or product only; do not sell, sublicense or redistribute this component on its
 * own, in a bundle or as a ported version. Full text: THIRD_PARTY_NOTICES.md.
 */
/**
 * The Orb's WebGL engine: a TypeScript port of React Bits' Crystalized Ball, with eased
 * props, an imperative pulse/spark API, shared pointer listeners and explicit lifecycle hooks. Browser only; the React
 * component loads this module lazily so it never runs during SSR.
 */
import { Geometry, Mesh, Program, Renderer, RenderTarget, Texture, Triangle } from "ogl";
import type { OGLRenderingContext } from "ogl";
import { clamp, fromOklab, parseColor, seeded, smooth, toOklab, type Rgb } from "../color";
import { buildPalette, easeOut, wrapAngle, type OrbPalette } from "./palette";
import { stepNumbers, stepVector } from "../interpolate";
import { subscribePointer, type PointerSpot, type PointerSubscriber } from "../pointer";
import type { OrbParams } from "../presets";
import { createContext } from "../support";
import { buildDust, buildStrands, MAX_ARCS, MAX_PARTICLES, MAX_STRANDS, STATE_WIDTH } from "./data";
import { compositeFragment, dustFragment, dustVertex, fieldFragment, passVertex, stirFragment } from "./shaders";

const MOTIONS = { rise: 0, fall: 1, drift: 2, orbit: 3 } as const;
const SHAPES = { square: 0, round: 1 } as const;
const PIXEL_BUDGET = 4.5e6;
const INTRO_SECONDS = 2.2;
const SETTLE_SECONDS = 7;
/** Used when a colour string cannot be resolved: the apricot accent. */
const FALLBACK_RGB: Rgb = [0.96, 0.66, 0.42];

/** Everything the engine reads each frame. The React component owns this and passes it to `update`. */
export interface OrbEngineSettings {
  params: OrbParams;
  /** Palette for light backgrounds. */
  light: boolean;
  /** Orb diameter as a share of the container's shorter side, 0.1..1.5. */
  size: number;
  /** Rim animation speed multiplier. */
  speed: number;
  interactive: boolean;
  /** Pointer influence, 0..1. */
  hoverStrength: number;
  intro: boolean;
  paused: boolean;
  /** One still frame, no pointer response, no pulses. */
  reducedMotion: boolean;
  /** Easing time constant in seconds for numeric params and colour; 0 snaps. */
  transition: number;
}

export interface OrbEngine {
  update(settings: OrbEngineSettings): void;
  pulse(strength?: number, angle?: number): void;
  spark(angle?: number): void;
  dispose(): void;
}

/** Numeric settings that ease. `strands` eases too: the shader fades the fractional strand in. */
const EASED = ["strands", "crackle", "flares", "glow", "sparks", "fill", "depth", "sway", "twinkle", "haze", "dustSpeed", "size", "speed", "hoverStrength"] as const;
type EasedKey = (typeof EASED)[number];

const easedTargets = (s: OrbEngineSettings): Record<EasedKey, number> => ({
  strands: clamp(s.params.strands, 1, MAX_STRANDS),
  crackle: s.params.crackle,
  flares: s.params.flares,
  glow: s.params.glow,
  sparks: s.params.sparks,
  fill: s.params.fill,
  depth: s.params.depth,
  sway: s.params.sway,
  twinkle: s.params.twinkle,
  haze: s.params.haze,
  dustSpeed: s.params.dustSpeed,
  size: s.size,
  speed: s.speed,
  hoverStrength: s.hoverStrength,
});

interface Arc {
  start: number;
  span: number;
  curl: number;
  life: number;
  duration: number;
  drift: number;
  strength: number;
}

/**
 * Mounts an Orb canvas into `container`. Returns null without WebGL2 (the caller shows the CSS fallback).
 * `onLost` fires if the GPU drops the context later.
 */
export function createOrbEngine(container: HTMLElement, initial: OrbEngineSettings, onLost?: () => void): OrbEngine | null {
  const ctx = createContext();
  if (!ctx) return null;
  const { canvas } = ctx;
  const renderer = new Renderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, depth: false, webgl: 2 });
  const gl: OGLRenderingContext = renderer.gl;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  const fullFloat = !!gl.getExtension("EXT_color_buffer_float");
  const halfFloat = fullFloat || !!gl.getExtension("EXT_color_buffer_half_float");
  const g2 = gl as WebGL2RenderingContext;
  const encode = halfFloat ? 1 : 0.25;
  const geometry = new Triangle(gl);
  const blank = new Texture(gl);
  const strandData = buildStrands();

  const sceneTarget = new RenderTarget(gl, {
    width: 1, height: 1, depth: false,
    type: halfFloat ? g2.HALF_FLOAT : gl.UNSIGNED_BYTE,
    format: gl.RGBA,
    internalFormat: halfFloat ? g2.RGBA16F : gl.RGBA,
    minFilter: gl.NEAREST, magFilter: gl.NEAREST,
  });

  const arcData = new Array<number>(MAX_ARCS * 4).fill(0);
  const fieldUniforms = {
    uCenter: { value: [0, 0] }, uRadius: { value: 1 }, uDpr: { value: 1 }, uLine: { value: 0.6 },
    uTime: { value: 0 }, uFrame: { value: 0 }, uBins: { value: 420 }, uStrands: { value: 5 },
    uCrackle: { value: 0.6 }, uFlares: { value: 0.5 }, uGlow: { value: 0.8 }, uHaze: { value: 0.7 },
    uFill: { value: 0.5 }, uPresence: { value: 0 }, uUnfold: { value: 0 }, uBloom: { value: 0 },
    uInside: { value: 0 }, uEncode: { value: encode },
    uRim: { value: [1, 1, 1] as Rgb }, uRimHot: { value: [1, 1, 1] as Rgb }, uRimMid: { value: [1, 1, 1] as Rgb }, uRimDeep: { value: [1, 1, 1] as Rgb },
    uSpark: { value: [1, 1, 1] as Rgb }, uSparkGlow: { value: [1, 1, 1] as Rgb }, uHazeColor: { value: [0, 0, 0] as Rgb }, uEdgeColor: { value: [0, 0, 0] as Rgb },
    uHeat: { value: [0, 0, 0, 0] },
    uHarmonics: { value: strandData.harmonics }, uRates: { value: strandData.rates }, uPhases: { value: strandData.phases },
    uFlareHarmonics: { value: strandData.flareHarmonics }, uFlareRates: { value: strandData.flareRates }, uFlarePhases: { value: strandData.flarePhases },
    uArcs: { value: arcData },
  };

  const dustShared = {
    uDustTime: { value: 0 }, uTurn: { value: [0, 0] }, uMotion: { value: 0 }, uFill: fieldUniforms.uFill,
    tHome: { value: blank }, tSeed: { value: blank },
  };

  const dustUniforms = {
    ...dustShared, tOffset: { value: blank }, uStirred: { value: 0 }, uCenter: fieldUniforms.uCenter,
    uViewport: { value: [1, 1] }, uRadius: fieldUniforms.uRadius, uDpr: fieldUniforms.uDpr,
    uDepth: { value: 0.6 }, uTwinkle: { value: 0.5 }, uPointScale: { value: 1 }, uReveal: { value: 0 },
    uEncode: { value: encode }, uTones: { value: new Array<number>(15).fill(1) }, uRimTone: { value: [1, 1, 1] as Rgb }, uShape: { value: 0 },
  };

  const stirUniforms = {
    ...dustShared, tOffset: { value: blank }, tVelocity: { value: blank }, uDt: { value: 0.016 },
    uReset: { value: 1 }, uBrush: { value: [0, 0, 0, 0] }, uBrushPower: { value: 0 }, uKick: { value: [0, 0, 0, 0] },
  };

  const compositeUniforms = { tScene: { value: sceneTarget.texture }, uLight: { value: 0 }, uDecode: { value: 1 / encode } };

  const additive = (program: Program) => {
    program.setBlendFunc(gl.ONE, gl.ONE);
    return program;
  };
  const passOptions = { depthTest: false, depthWrite: false };

  const fieldProgram = additive(new Program(gl, { vertex: passVertex, fragment: fieldFragment, uniforms: fieldUniforms, transparent: true, ...passOptions }));
  const fieldMesh = new Mesh(gl, { geometry, program: fieldProgram });
  const dustProgram = additive(new Program(gl, { vertex: dustVertex, fragment: dustFragment, uniforms: dustUniforms, transparent: true, ...passOptions }));
  const stirProgram = halfFloat ? new Program(gl, { vertex: passVertex, fragment: stirFragment, uniforms: stirUniforms, ...passOptions }) : null;
  const stirMesh = stirProgram ? new Mesh(gl, { geometry, program: stirProgram }) : null;
  const compositeProgram = new Program(gl, { vertex: passVertex, fragment: compositeFragment, uniforms: compositeUniforms, ...passOptions });
  const compositeMesh = new Mesh(gl, { geometry, program: compositeProgram });

  const disposeTarget = (target: RenderTarget | null) => {
    if (!target) return;
    gl.deleteFramebuffer(target.buffer);
    for (const texture of target.textures) gl.deleteTexture(texture.texture);
  };

  const stateTarget = (rows: number) =>
    new RenderTarget(gl, {
      width: STATE_WIDTH, height: rows, color: 2, depth: false,
      type: fullFloat ? gl.FLOAT : g2.HALF_FLOAT, format: gl.RGBA,
      internalFormat: fullFloat ? g2.RGBA32F : g2.RGBA16F, minFilter: gl.NEAREST, magFilter: gl.NEAREST,
    });

  const dataTexture = (data: Float32Array, rows: number) =>
    new Texture(gl, {
      image: data, width: STATE_WIDTH, height: rows, type: gl.FLOAT, format: gl.RGBA, internalFormat: g2.RGBA32F,
      minFilter: gl.NEAREST, magFilter: gl.NEAREST, generateMipmaps: false, flipY: false,
    });

  interface DustLayer {
    requested: number;
    rows: number;
    home: Texture;
    seed: Texture;
    mesh: Mesh;
    read: RenderTarget | null;
    write: RenderTarget | null;
  }
  let dust: DustLayer | null = null;
  let stirring = 0;

  const disposeDust = () => {
    if (!dust) return;
    dust.mesh.geometry.remove();
    gl.deleteTexture(dust.home.texture);
    gl.deleteTexture(dust.seed.texture);
    disposeTarget(dust.read);
    disposeTarget(dust.write);
    dust = null;
  };

  const resetStir = () => {
    if (!stirMesh || !dust || !dust.read || !dust.write) return;
    stirUniforms.tOffset.value = blank;
    stirUniforms.tVelocity.value = blank;
    stirUniforms.uReset.value = 1;
    renderer.render({ scene: stirMesh, target: dust.read, clear: false });
    renderer.render({ scene: stirMesh, target: dust.write, clear: false });
    stirUniforms.uReset.value = 0;
  };

  const rebuildDust = (requested: number) => {
    const total = clamp(Math.round(requested / 100) * 100, 0, MAX_PARTICLES);
    if (dust && dust.requested === total) return;
    disposeDust();
    if (!total) return;
    const data = buildDust(total);
    const indices = new Float32Array(data.count);
    for (let i = 0; i < data.count; i++) indices[i] = i;
    const points = new Geometry(gl, { aIndex: { size: 1, data: indices } });
    dust = {
      requested: total, rows: data.rows,
      home: dataTexture(data.home, data.rows), seed: dataTexture(data.seed, data.rows),
      mesh: new Mesh(gl, { mode: gl.POINTS, geometry: points, program: dustProgram }),
      read: stirMesh ? stateTarget(data.rows) : null, write: stirMesh ? stateTarget(data.rows) : null,
    };
    dustShared.tHome.value = dust.home;
    dustShared.tSeed.value = dust.seed;
    resetStir();
    stirring = 0;
  };

  // --- settings and easing --------------------------------------------------------------------------------------
  let settings = initial;
  const eased = easedTargets(initial);
  let colorKey = "";
  let colorTarget = toOklab(FALLBACK_RGB) as number[];
  const colorNow: number[] = [];
  let palette: OrbPalette;
  let paletteDirty = true;
  const retargetColor = (s: OrbEngineSettings) => {
    if (s.params.color === colorKey) return;
    colorKey = s.params.color;
    colorTarget = toOklab(parseColor(s.params.color, FALLBACK_RGB));
    paletteDirty = true;
  };
  retargetColor(initial);
  colorNow.push(...colorTarget);

  const random = seeded(913);
  let width = 1;
  let height = 1;
  let raf = 0;
  let last = performance.now();
  let rimTime = 0;
  let dustTime = 0;
  let swayClock = 0;
  let introClock = 0;
  let visible = true;
  let alive = true;
  let surge = 0;
  let stirEnergy = 0;
  let kick: { x: number; y: number; strength: number } | null = null;
  let nextArc = 0.3;
  const arcs: Arc[] = [];
  const pointer = { x: 0, y: 0, inside: false, fresh: true };
  const heat = { angle: 0, velocity: 0, power: 0, near: 0 };
  const brush = { x: 0, y: 0, vx: 0, vy: 0 };
  const look = { x: 0, y: 0, vx: 0, vy: 0 };

  const radiusOf = (size: number) => Math.max(8, (clamp(size, 0.1, 1.5) * Math.min(width, height)) / 2);

  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PIXEL_BUDGET / (width * height)));
    renderer.setSize(width, height);
    sceneTarget.setSize(gl.canvas.width, gl.canvas.height);
    start();
  };

  const spawnArc = (angle: number, strength: number, force = false) => {
    if (arcs.length >= MAX_ARCS) {
      if (!force) return;
      arcs.shift();
    }
    arcs.push({
      start: angle, span: (0.05 + random() * 0.07) * (random() < 0.5 ? -1 : 1), curl: 0.02 + random() * 0.04,
      life: 0, duration: 0.2 + random() * 0.2, drift: (random() - 0.5) * 0.3, strength,
    });
  };

  const frame = (now: number) => {
    raf = 0;
    if (!alive) return;
    const s = settings;
    const dt = Math.min(0.05, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    const reduced = s.reducedMotion;
    const tau = reduced ? 0 : Math.max(0, s.transition);

    // Ease data-driven params and colour towards their targets.
    let easing = stepNumbers(eased, easedTargets(s), dt, tau);
    const colorMoving = stepVector(colorNow, colorTarget, dt, tau);
    easing ||= colorMoving;
    if (colorMoving || paletteDirty) {
      palette = buildPalette(fromOklab(colorNow as [number, number, number]), s.light);
      paletteDirty = false;
    }

    const moving = !s.paused && !reduced;
    introClock = s.intro && !reduced ? Math.min(1, introClock + dt / INTRO_SECONDS) : 1;
    const presence = easeOut(smooth(0, 0.42, introClock));
    const unfold = easeOut(smooth(0, 0.32, introClock));
    const charge = Math.sin(Math.PI * smooth(0.22, 0.78, introClock)) * 0.35;
    const radius = radiusOf(eased.size);

    const strength = s.interactive && !reduced ? clamp(eased.hoverStrength, 0, 1) : 0;
    const px = pointer.x - width / 2;
    const py = height / 2 - pointer.y;
    const reach = Math.hypot(px, py);
    const target = pointer.inside ? strength : 0;
    if (heat.power < 0.02) {
      heat.angle = Math.atan2(py, px);
      heat.velocity = 0;
    }
    const turn = wrapAngle(Math.atan2(py, px) - heat.angle);
    heat.velocity += (120 * turn - 19 * heat.velocity) * dt;
    heat.angle = wrapAngle(heat.angle + heat.velocity * dt);
    heat.power += (target - heat.power) * (1 - Math.exp(-dt / (target > heat.power ? 0.3 : 0.55)));
    const nearTarget = Math.exp(-Math.pow((reach - radius) / (radius * 0.45), 2));
    heat.near += (nearTarget - heat.near) * (1 - Math.exp(-dt / 0.15));
    surge *= Math.exp(-dt / 0.7);

    const bx = px / radius;
    const by = py / radius;
    if (Math.hypot(bx - brush.x, by - brush.y) > 0.6) pointer.fresh = true;
    if (pointer.fresh) {
      brush.x = bx;
      brush.y = by;
      brush.vx = 0;
      brush.vy = 0;
      pointer.fresh = false;
    }
    const follow = 1 - Math.exp(-dt / 0.05);
    brush.vx += ((bx - brush.x) / dt - brush.vx) * follow;
    brush.vy += ((by - brush.y) / dt - brush.vy) * follow;
    brush.x = bx;
    brush.y = by;
    const brushSpeed = Math.hypot(brush.vx, brush.vy);
    const cap = brushSpeed > 4 ? 4 / brushSpeed : 1;
    const inBall = Math.exp(-Math.max(0, Math.hypot(bx, by) - 1) * 6);
    const brushPower = pointer.inside ? strength * inBall * presence : 0;
    stirEnergy = stirEnergy * Math.exp(-dt / 1.2) + brushPower * Math.min(brushSpeed, 4) * dt;

    if (moving) {
      const pace = 1 + surge * 0.6 + heat.power * heat.near * 0.3;
      const step = dt * Math.max(0, eased.speed) * 2 * pace;
      rimTime += step;
      dustTime += dt * Math.max(0, eased.dustSpeed) * (1 + surge * 0.4);
      swayClock += dt * Math.max(0, eased.dustSpeed);
      const crackleNow = clamp(eased.crackle + surge * 0.5, 0, 1.5);
      if (eased.sparks > 0.01 && introClock > 0.55) {
        nextArc -= step * eased.sparks * 2 * (0.6 + crackleNow * 0.6);
        if (nextArc <= 0) {
          const local = heat.power * heat.near;
          const angle =
            random() < local * 0.7
              ? heat.angle + (random() - 0.5) * 0.8
              : random() < 0.7
                ? Math.PI / 2 + (random() - 0.5) * 1.5
                : random() * Math.PI * 2;
          spawnArc(angle, 0.8 + local * 0.6 + surge * 0.4);
          nextArc = 0.15 + random() * 0.6;
        }
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        const arc = arcs[i]!;
        arc.life += step;
        arc.start += arc.drift * step;
        if (arc.life >= arc.duration) arcs.splice(i, 1);
      }
    } else {
      arcs.length = 0;
    }
    for (let i = 0; i < MAX_ARCS; i++) {
      const arc = arcs[i];
      arcData[i * 4] = arc ? arc.start : 0;
      arcData[i * 4 + 1] = arc ? arc.span : 0;
      arcData[i * 4 + 2] = arc ? arc.curl : 0;
      arcData[i * 4 + 3] = arc ? Math.sin((Math.PI * arc.life) / arc.duration) * arc.strength : 0;
    }

    rebuildDust(s.params.particleCount);

    fieldUniforms.uCenter.value = [width / 2, height / 2];
    fieldUniforms.uRadius.value = radius;
    fieldUniforms.uDpr.value = renderer.dpr;
    fieldUniforms.uLine.value = Math.max(0.6, radius * 0.0035);
    fieldUniforms.uTime.value = rimTime;
    fieldUniforms.uFrame.value = Math.floor(rimTime * 24) % 100000;
    fieldUniforms.uBins.value = clamp(Math.round((Math.PI * 2 * radius) / 2.6), 240, 900);
    fieldUniforms.uStrands.value = clamp(eased.strands, 1, MAX_STRANDS);
    fieldUniforms.uCrackle.value = clamp(eased.crackle, 0, 1) + surge * 0.5 + charge;
    fieldUniforms.uFlares.value = clamp(eased.flares, 0, 1);
    fieldUniforms.uGlow.value = clamp(eased.glow, 0, 2) * (1 + surge * 0.5 + charge) * (s.light ? 0.35 : 1);
    fieldUniforms.uHaze.value = clamp(eased.haze, 0, 2) * (s.light ? 0.6 : 1);
    fieldUniforms.uFill.value = clamp(eased.fill, 0, 1);
    fieldUniforms.uPresence.value = presence;
    fieldUniforms.uUnfold.value = unfold;
    fieldUniforms.uBloom.value = presence * presence;
    fieldUniforms.uInside.value = smooth(0.2, 0.95, introClock);
    fieldUniforms.uRim.value = palette.rim;
    fieldUniforms.uRimHot.value = palette.rimHot;
    fieldUniforms.uRimMid.value = palette.rimMid;
    fieldUniforms.uRimDeep.value = palette.rimDeep;
    fieldUniforms.uSpark.value = palette.spark;
    fieldUniforms.uSparkGlow.value = palette.sparkGlow;
    fieldUniforms.uHazeColor.value = palette.haze;
    fieldUniforms.uEdgeColor.value = palette.edge;
    fieldUniforms.uHeat.value = [heat.angle, heat.near, heat.power * presence, 0];

    dustShared.uDustTime.value = dustTime;
    const gaze = pointer.inside ? strength * presence : 0;
    const lookX = clamp(bx, -1.6, 1.6) * gaze;
    const lookY = clamp(by, -1.6, 1.6) * gaze;
    look.vx += (40 * (lookX - look.x) - 11 * look.vx) * dt;
    look.vy += (40 * (lookY - look.y) - 11 * look.vy) * dt;
    look.x += look.vx * dt;
    look.y += look.vy * dt;
    const swing = clamp(eased.sway, 0, 1);
    dustShared.uTurn.value = [
      swing * 0.42 * Math.sin(swayClock * 0.23) + look.x * 0.3,
      swing * 0.12 * Math.sin(swayClock * 0.17 + 1.3) - look.y * 0.16,
    ];
    dustShared.uMotion.value = MOTIONS[s.params.motion] ?? 0;
    dustUniforms.uViewport.value = [width, height];
    dustUniforms.uDepth.value = clamp(eased.depth, 0, 1);
    dustUniforms.uTwinkle.value = clamp(eased.twinkle, 0, 1);
    dustUniforms.uPointScale.value = Math.max(1, radius / 491);
    dustUniforms.uReveal.value = smooth(0.18, 1, introClock);
    dustUniforms.uTones.value = palette.tones.flat();
    dustUniforms.uRimTone.value = palette.rim;
    dustUniforms.uShape.value = SHAPES[s.params.particleShape] ?? 0;

    const layer = dust as DustLayer | null;
    if (layer && stirMesh && (stirEnergy > 0.002 || kick)) stirring = SETTLE_SECONDS;
    let stirred = false;
    if (layer && layer.read && layer.write && stirMesh && stirring > 0) {
      stirUniforms.uDt.value = Math.min(dt, 1 / 30);
      stirUniforms.uBrush.value = [brush.x, brush.y, brush.vx * cap, brush.vy * cap];
      stirUniforms.uBrushPower.value = brushPower;
      stirUniforms.uKick.value = kick ? [kick.x, kick.y, kick.strength, 0] : [0, 0, 0, 0];
      stirUniforms.tOffset.value = layer.read.textures[0]!;
      stirUniforms.tVelocity.value = layer.read.textures[1]!;
      renderer.render({ scene: stirMesh, target: layer.write, clear: false });
      const swap = layer.read;
      layer.read = layer.write;
      layer.write = swap;
      stirring -= dt;
      stirred = stirring > 0;
      if (!stirred) {
        stirring = 0;
        resetStir();
      }
    }
    kick = null;
    dustUniforms.uStirred.value = stirred ? 1 : 0;
    dustUniforms.tOffset.value = layer && layer.read ? layer.read.textures[0]! : blank;

    gl.clearColor(0, 0, 0, 0);
    renderer.render({ scene: fieldMesh, target: sceneTarget, clear: true });
    if (dust) renderer.render({ scene: (dust as DustLayer).mesh, target: sceneTarget, clear: false });

    compositeUniforms.uLight.value = s.light ? 1 : 0;
    renderer.render({ scene: compositeMesh, clear: false });

    const settling =
      easing || Math.abs(target - heat.power) > 0.002 || surge > 0.002 || stirring > 0 || arcs.length > 0 ||
      Math.abs(heat.velocity) > 0.01 || Math.hypot(look.vx, look.vy, look.x - lookX, look.y - lookY) > 0.001;
    if (visible && (moving || introClock < 1 || settling)) raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf || !visible || !alive || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const radiusNow = () => radiusOf(eased.size);

  const pointerSub: PointerSubscriber = {
    element: container,
    active: true,
    onMove: (spot: PointerSpot) => {
      if (spot.inside && !pointer.inside) pointer.fresh = true;
      pointer.x = spot.x;
      pointer.y = spot.y;
      pointer.inside = spot.inside;
      start();
    },
    onDown: (spot: PointerSpot) => {
      const s = settings;
      if (!s.interactive || s.reducedMotion || !spot.inside) return;
      if (!pointer.inside) pointer.fresh = true;
      pointer.x = spot.x;
      pointer.y = spot.y;
      pointer.inside = true;
      const radius = radiusNow();
      const kx = (spot.x - width / 2) / radius;
      const ky = (height / 2 - spot.y) / radius;
      if (Math.hypot(kx, ky) > 1.3) return;
      const strength = clamp(eased.hoverStrength, 0, 1);
      kick = { x: kx, y: ky, strength: strength * 1.2 };
      surge = Math.max(surge, strength);
      const angle = Math.atan2(ky, kx);
      spawnArc(angle + (random() - 0.5) * 0.5, 1.3);
      spawnArc(angle + Math.PI + (random() - 0.5) * 1.2, 1.1);
      start();
    },
    onLeave: () => {
      pointer.inside = false;
      start();
    },
  };
  const unsubscribe = subscribePointer(pointerSub);

  const onVisibility = () => {
    if (!document.hidden) start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onContextLost = (e: Event) => {
    e.preventDefault();
    alive = false;
    cancelAnimationFrame(raf);
    onLost?.();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    pointerSub.active = visible;
    start();
  });
  intersectionObserver.observe(container);

  resize();

  return {
    update(next) {
      if (next.light !== settings.light) paletteDirty = true;
      settings = next;
      retargetColor(next);
      start();
    },
    pulse(strength = 1, angle) {
      if (!alive || settings.reducedMotion) return;
      const s = clamp(strength, 0, 2);
      const a = angle ?? random() * Math.PI * 2;
      kick = { x: Math.cos(a) * 0.9, y: Math.sin(a) * 0.9, strength: s * 1.2 };
      surge = Math.max(surge, s);
      spawnArc(a + (random() - 0.5) * 0.5, 1.3, true);
      spawnArc(a + Math.PI + (random() - 0.5) * 1.2, 1.1, true);
      start();
    },
    spark(angle) {
      if (!alive || settings.reducedMotion || settings.paused) return;
      spawnArc(angle ?? random() * Math.PI * 2, 1.2, true);
      start();
    },
    dispose() {
      alive = false;
      visible = false;
      cancelAnimationFrame(raf);
      unsubscribe();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      disposeDust();
      disposeTarget(sceneTarget);
      geometry.remove();
      for (const p of [fieldProgram, dustProgram, stirProgram, compositeProgram]) p?.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
