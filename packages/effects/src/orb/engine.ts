/**
 * Orb engine: a glass sphere drawn as one full-canvas glow pass (rim, flares, halo, sparks, haze) plus a point cloud of
 * stateless dust. DPR is capped (and a per-orb pixel budget applied), and frames stop while hidden, offscreen, paused
 * or under reduced motion.
 */
import { Geometry, Mesh, Program, Renderer, Triangle } from "ogl";
import { clamp, fromOklab, parseColor, toOklab, type Rgb } from "../color";
import { stepNumbers, stepVector } from "../interpolate";
import { subscribePointer, type PointerSubscriber } from "../pointer";
import type { OrbParams } from "../presets";
import { createContext } from "../support";
import { buildDust } from "./data";
import { buildPalette, type OrbTheme } from "./palette";
import { dustFragment, dustVertex, glowFragment, glowVertex, MAX_SPARKS, MAX_STIRS } from "./shaders";

const FALLBACK_RGB: Rgb = [0.96, 0.7, 0.45];
/** Device pixels per orb canvas; above it the DPR drops. */
const PIXEL_BUDGET = 1.2e6;
const MAX_DPR = 2;
const INTRO_SECONDS = 2;
/** A frozen moment that reads well, for reduced motion. */
const STILL_TIME = 7.3;

export interface OrbEngineSettings {
  params: OrbParams;
  theme: OrbTheme;
  /** Diameter as a fraction of min(width, height). */
  size: number;
  speed: number;
  interactive: boolean;
  hoverStrength: number;
  intro: boolean;
  paused: boolean;
  reducedMotion: boolean;
  /** Easing time constant in seconds; 0 snaps. */
  transition: number;
}

export interface OrbEngine {
  update(settings: OrbEngineSettings): void;
  pulse(strength?: number, angle?: number): void;
  spark(angle?: number): void;
  dispose(): void;
}

interface Spark {
  angle: number;
  halfLength: number;
  radius: number;
  bend: number;
  age: number;
  life: number;
  seed: number;
  brightness: number;
  direction: number;
}

interface Stir {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  strength: number;
  spin: number;
}

/** Spark arcs per second for the given levels; pulses (`surge`) briefly raise it. */
export const sparkRate = (sparks: number, crackle: number, surge: number) =>
  2.6 * clamp(sparks, 0, 1) * (0.65 + 0.8 * clamp(crackle, 0, 1)) * (1 + 1.5 * clamp(surge, 0, 2));

const gauss = () => {
  let u = 0;
  for (let i = 0; i < 3; i++) u += Math.random();
  return (u - 1.5) / 0.5;
};

const wrapAngle = (a: number) => {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
};

const flat = (colors: readonly Rgb[]) => colors.flatMap((c) => [c[0], c[1], c[2]]);

export function createOrbEngine(container: HTMLElement, initial: OrbEngineSettings, onLost?: () => void): OrbEngine | null {
  const ctx = createContext();
  if (!ctx) return null;
  const { canvas } = ctx;
  const renderer = new Renderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, depth: false, webgl: 2 });
  const gl = renderer.gl;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  const sparkData = new Array<number>(MAX_SPARKS * 8).fill(0);
  const stirData = new Array<number>(MAX_STIRS * 8).fill(0);
  const view = {
    uCanvas: { value: [1, 1] }, uCenter: { value: [0.5, 0.5] }, uRadius: { value: 1 }, uLight: { value: 0 }, uTime: { value: 0 },
    uFill: { value: 0.5 }, uIntro: { value: 1 }, uSurge: { value: 0 },
  };
  const glowProgram = new Program(gl, {
    vertex: glowVertex,
    fragment: glowFragment,
    uniforms: {
      ...view,
      uLine: { value: 0.006 }, uFeather: { value: 8 }, uReach: { value: 0.2 }, uStrands: { value: 4 }, uCrackle: { value: 0.3 }, uFlares: { value: 0.4 },
      uGlow: { value: 1 }, uHaze: { value: 1 }, uHeat: { value: [Math.PI / 2, 0] }, uSparks: { value: sparkData },
      uRimColor: { value: [1, 1, 1] }, uHotColor: { value: [1, 1, 1] }, uHaloColor: { value: [1, 1, 1] }, uHazeColor: { value: [1, 1, 1] },
      uSparkColor: { value: [1, 1, 1] },
    },
    transparent: true, depthTest: false, depthWrite: false,
  });
  const triangle = new Triangle(gl);
  const glow = new Mesh(gl, { geometry: triangle, program: glowProgram });
  const dustProgram = new Program(gl, {
    vertex: dustVertex,
    fragment: dustFragment,
    uniforms: {
      ...view,
      uPointScale: { value: 1 }, uGain: { value: 1 }, uMotionMix: { value: [1, 0, 0, 0] }, uTwinkle: { value: 0.4 }, uDepth: { value: 0.6 },
      uRotation: { value: [0, 0] }, uKick: { value: [0, 0, 10, 0] }, uStirs: { value: stirData }, uTones: { value: new Array<number>(15).fill(1) },
      uRound: { value: 0 },
    },
    transparent: true, depthTest: false, depthWrite: false,
  });

  let theme: OrbTheme | null = null;
  const applyTheme = (next: OrbTheme) => {
    if (next === theme) return;
    theme = next;
    glowProgram.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (next === "light") dustProgram.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else dustProgram.setBlendFunc(gl.ONE, gl.ONE);
    paletteKey = "";
  };

  let dust: { count: number; mesh: Mesh } | null = null;
  const rebuildDust = (count: number) => {
    if ((dust?.count ?? 0) === count) return;
    dust?.mesh.geometry.remove();
    dust = null;
    if (count <= 0) return;
    const data = buildDust(count);
    const geometry = new Geometry(gl, { aPlace: { size: 4, data: data.place }, aMotion: { size: 4, data: data.motion } });
    dust = { count, mesh: new Mesh(gl, { mode: gl.POINTS, geometry, program: dustProgram }) };
  };

  let settings = initial;
  const easedTarget = (s: OrbEngineSettings) => {
    const p = s.params;
    return {
      strands: p.strands, crackle: p.crackle, flares: p.flares, glow: p.glow, sparks: p.sparks, fill: p.fill, depth: p.depth, sway: p.sway,
      twinkle: p.twinkle, haze: p.haze, dustSpeed: p.dustSpeed, size: clamp(s.size, 0.05, 1.5), speed: Math.max(0, s.speed),
      hoverStrength: clamp(s.hoverStrength, 0, 2),
      rise: p.motion === "rise" ? 1 : 0, fall: p.motion === "fall" ? 1 : 0, drift: p.motion === "drift" ? 1 : 0, orbit: p.motion === "orbit" ? 1 : 0,
    };
  };
  const eased = easedTarget(initial);

  let colorKey = "";
  let colorTarget: number[] = [];
  const colorNow: number[] = [];
  const retargetColor = (s: OrbEngineSettings) => {
    if (s.params.color === colorKey) return;
    colorKey = s.params.color;
    colorTarget = toOklab(parseColor(s.params.color, FALLBACK_RGB));
  };
  retargetColor(initial);
  colorNow.push(...colorTarget);
  let paletteKey = "";
  const applyPalette = () => {
    const key = `${theme}:${colorNow.map((v) => v.toFixed(4)).join(",")}`;
    if (key === paletteKey) return;
    paletteKey = key;
    const pal = buildPalette(fromOklab(colorNow as [number, number, number]), theme ?? "dark");
    const u = glowProgram.uniforms;
    u.uRimColor!.value = pal.rim;
    u.uHotColor!.value = pal.hot;
    u.uHaloColor!.value = pal.halo;
    u.uHazeColor!.value = pal.haze;
    u.uSparkColor!.value = pal.spark;
    dustProgram.uniforms.uTones!.value = flat(pal.dust);
  };
  applyTheme(initial.theme);

  let width = 1;
  let height = 1;
  let raf = 0;
  let last = performance.now();
  let rimTime = 0;
  let dustTime = 0;
  let yaw = 0;
  let introT = initial.intro ? 0 : INTRO_SECONDS;
  let introStarted = !initial.intro;
  let visible = false;
  let alive = true;
  let dirty = true;
  let surge = 0;
  const kick = { x: 0, y: 0, age: 10, strength: 0 };
  const sparks: Spark[] = [];
  const stirs: Stir[] = [];
  const pointer = { x: 0, y: 0, inside: false, lastX: 0, lastY: 0, lastT: 0, stirX: 99, stirY: 99, stirT: 0 };
  const heat = { angle: Math.PI / 2, velocity: 0, amount: 0 };
  const tilt = { x: 0, y: 0 };

  const radiusCss = () => (clamp(eased.size, 0.05, 1.5) * Math.min(width, height)) / 2;

  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1, Math.sqrt(PIXEL_BUDGET / (width * height)));
    renderer.setSize(width, height);
    dirty = true;
    start();
  };

  const spawnSpark = (angle: number | undefined, boost = 1) => {
    if (sparks.length >= MAX_SPARKS) sparks.shift();
    let at: number;
    if (angle !== undefined && Number.isFinite(angle)) at = angle + gauss() * 0.18;
    else if (heat.amount > 0.25 && Math.random() < 0.75) at = heat.angle + gauss() * 0.3;
    else if (Math.random() < 0.8) at = Math.PI / 2 + gauss() * 0.75;
    else at = Math.random() * Math.PI * 2;
    const r = Math.random();
    sparks.push({
      angle: wrapAngle(at),
      halfLength: 0.12 + 0.28 * Math.random(),
      radius: 0.9 + 0.065 * Math.random(),
      bend: (Math.random() < 0.7 ? 1 : -1) * (0.015 + 0.045 * r),
      age: 0,
      life: 0.22 + 0.4 * Math.random(),
      seed: Math.random() * 10,
      brightness: (0.85 + 0.6 * Math.random()) * boost,
      direction: Math.random() < 0.5 ? -1 : 1,
    });
  };

  const animating = () => visible && !settings.paused && !settings.reducedMotion && !document.hidden;

  const frame = (now: number) => {
    raf = 0;
    if (!alive) return;
    const s = settings;
    const dt = Math.min(0.1, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    const reduced = s.reducedMotion;
    const tau = reduced ? 0 : Math.max(0, s.transition);
    const target = easedTarget(s);
    const easing = stepNumbers(eased, target, dt, tau);
    const colorMoving = stepVector(colorNow, colorTarget, dt, tau);
    const moving = animating();

    // Clocks: rim and dust advance only while animating; sparks, surges and pointer springs use real time.
    if (moving) {
      rimTime += dt * eased.speed;
      dustTime += dt * eased.speed * eased.dustSpeed;
      yaw += dt * eased.speed * eased.sway * 0.16;
      if (introStarted) introT = Math.min(INTRO_SECONDS, introT + dt);
    }
    // Paused or reduced before the intro began: show the finished orb rather than an empty one.
    if ((s.paused || reduced) && introT === 0) introT = INTRO_SECONDS;
    const intro = reduced || !s.intro ? 1 : introT / INTRO_SECONDS;

    surge *= Math.exp(-dt / 0.45);
    if (surge < 0.002) surge = 0;
    kick.age += dt;
    for (const sp of sparks) sp.age += dt;
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i]!.age >= sparks[i]!.life) sparks.splice(i, 1);
    for (const st of stirs) st.age += dt;
    while (stirs.length && stirs[0]!.age > 5) stirs.shift();

    // Pointer: heat follows the pointer angle on a slightly underdamped spring; the cloud tilts toward it.
    const R = radiusCss();
    const interactive = s.interactive && !reduced;
    let heatTarget = 0;
    let tiltX = 0;
    let tiltY = 0;
    if (interactive && pointer.inside && R > 0) {
      const px = (pointer.x - width / 2) / R;
      const py = (height / 2 - pointer.y) / R;
      const dist = Math.hypot(px, py);
      heatTarget = eased.hoverStrength * clamp(1.35 - Math.abs(dist - 1) * 1.1, 0.3, 1);
      const delta = wrapAngle(Math.atan2(py, px) - heat.angle);
      heat.velocity += (delta * 60 - heat.velocity * 11) * dt;
      tiltX = clamp(px, -1.2, 1.2) * eased.hoverStrength;
      tiltY = clamp(py, -1.2, 1.2) * eased.hoverStrength;
    } else {
      heat.velocity *= Math.exp(-dt * 8);
    }
    heat.angle = wrapAngle(heat.angle + heat.velocity * dt);
    heat.amount += (heatTarget - heat.amount) * (1 - Math.exp(-dt / 0.22));
    const k = 1 - Math.exp(-dt / 0.5);
    tilt.x += (tiltX - tilt.x) * k;
    tilt.y += (tiltY - tilt.y) * k;
    const settling = Math.abs(heat.amount - heatTarget) > 0.003 || Math.abs(heat.velocity) > 0.01 || Math.hypot(tilt.x - tiltX, tilt.y - tiltY) > 0.002;

    // Sparks: random arcs at the set rate, plus an extra charge during the intro.
    const introCharge = intro < 1 ? Math.sin(Math.PI * clamp((intro - 0.3) / 0.6, 0, 1)) : 0;
    if (moving && intro > 0.35) {
      const rate = sparkRate(eased.sparks, eased.crackle, surge) + introCharge * 3;
      if (Math.random() < rate * dt) spawnSpark(undefined);
    }

    const busy = sparks.length > 0 || surge > 0 || kick.age < 3 || stirs.length > 0 || settling;
    const draw = moving || dirty || easing || colorMoving || busy || (intro < 1 && moving);
    if (draw) {
      dirty = false;
      rebuildDust(s.params.particleCount);
      applyTheme(s.theme);
      applyPalette();
      const dpr = renderer.dpr;
      const Rdev = Math.max(1, R * dpr);
      view.uCanvas.value = [width * dpr, height * dpr];
      view.uCenter.value = [(width * dpr) / 2, (height * dpr) / 2];
      view.uRadius.value = Rdev;
      view.uLight.value = theme === "light" ? 1 : 0;
      view.uTime.value = reduced ? STILL_TIME : rimTime + 3.1;
      view.uFill.value = eased.fill;
      view.uIntro.value = intro;
      view.uSurge.value = surge;

      const g = glowProgram.uniforms;
      g.uLine!.value = Math.max(0.0062, 0.95 / Rdev);
      g.uReach!.value = Math.max(0.02, (Math.min(width, height) / 2 - R) / Math.max(R, 1));
      g.uFeather!.value = 10 * dpr;
      g.uStrands!.value = clamp(eased.strands, 1, 8);
      g.uCrackle!.value = clamp(eased.crackle + surge * 0.45, 0, 1.6);
      g.uFlares!.value = eased.flares;
      g.uGlow!.value = eased.glow;
      g.uHaze!.value = eased.haze;
      g.uHeat!.value = [heat.angle, heat.amount];
      sparkData.fill(0);
      sparks.forEach((sp, i) => {
        const o = i * 8;
        sparkData[o] = sp.angle;
        sparkData[o + 1] = sp.halfLength;
        sparkData[o + 2] = sp.radius;
        sparkData[o + 3] = sp.bend;
        sparkData[o + 4] = clamp(sp.age / sp.life, 0.0001, 1);
        sparkData[o + 5] = sp.seed;
        sparkData[o + 6] = sp.brightness;
        sparkData[o + 7] = sp.direction;
      });
      g.uSparks!.value = sparkData;

      const d = dustProgram.uniforms;
      const count = dust?.count ?? 0;
      // Keep the cloud's overall brightness steady when it gets denser (more particles, or a smaller orb).
      const density = count / Math.max(1, Math.PI * R * R);
      d.uGain!.value = Math.pow(clamp(0.3 / Math.max(density, 1e-4), 0.12, 1.4), 0.55) * (theme === "light" ? 0.9 : 1);
      d.uPointScale!.value = dpr * clamp(R / 170, 0.5, 1.2);
      d.uTime!.value = reduced ? STILL_TIME * 0.8 : dustTime + 2;
      const total = eased.rise + eased.fall + eased.drift + eased.orbit || 1;
      d.uMotionMix!.value = [eased.rise / total, eased.fall / total, eased.drift / total, eased.orbit / total];
      d.uTwinkle!.value = eased.twinkle;
      d.uDepth!.value = eased.depth;
      const swayTime = reduced ? STILL_TIME : rimTime;
      d.uRotation!.value = [
        yaw + eased.sway * 0.25 * Math.sin(swayTime * 0.11) + tilt.x * 0.28,
        eased.sway * 0.1 * Math.sin(swayTime * 0.07 + 1.3) - tilt.y * 0.2,
      ];
      d.uKick!.value = [kick.x, kick.y, kick.age, kick.strength];
      stirData.fill(0);
      stirs.slice(-MAX_STIRS).forEach((st, i) => {
        const o = i * 8;
        stirData[o] = st.x;
        stirData[o + 1] = st.y;
        stirData[o + 2] = st.vx;
        stirData[o + 3] = st.vy;
        stirData[o + 4] = st.age;
        stirData[o + 5] = st.strength;
        stirData[o + 6] = st.spin;
      });
      d.uStirs!.value = stirData;
      d.uRound!.value = s.params.particleShape === "round" ? 1 : 0;

      gl.clearColor(0, 0, 0, 0);
      renderer.render({ scene: glow, clear: true });
      if (dust) renderer.render({ scene: dust.mesh, clear: false });
    }

    if (visible && !document.hidden && (moving || easing || colorMoving || busy)) raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf || !visible || !alive || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const pointerSub: PointerSubscriber = {
    element: container,
    active: false,
    onMove: (spot) => {
      pointer.inside = spot.inside;
      pointer.x = spot.x;
      pointer.y = spot.y;
      const R = radiusCss();
      if (!spot.inside || R <= 0) return start();
      const now = performance.now();
      const px = (spot.x - width / 2) / R;
      const py = (height / 2 - spot.y) / R;
      const dt = Math.max(0.008, (now - pointer.lastT) / 1000);
      const vx = clamp((px - pointer.lastX) / dt, -12, 12);
      const vy = clamp((py - pointer.lastY) / dt, -12, 12);
      const fresh = now - pointer.lastT < 200;
      pointer.lastX = px;
      pointer.lastY = py;
      pointer.lastT = now;
      // Stir the dust when moving inside the sphere, at most every 70 ms and only after real movement.
      if (fresh && Math.hypot(px, py) < 1 && now - pointer.stirT > 70 && Math.hypot(px - pointer.stirX, py - pointer.stirY) > 0.05) {
        const speed = Math.hypot(vx, vy);
        if (stirs.length >= MAX_STIRS) stirs.shift();
        // Swirl the way the pointer turns around the centre, so stirring feels like a spoon in water.
        const spin = px * vy - py * vx >= 0 ? 1 : -1;
        stirs.push({ x: px, y: py, vx, vy, age: 0, spin, strength: clamp(speed / 4, 0.1, 1) * clamp(settings.hoverStrength, 0, 2) });
        pointer.stirX = px;
        pointer.stirY = py;
        pointer.stirT = now;
      }
      start();
    },
    onDown: (spot) => {
      if (!spot.inside) return;
      const R = radiusCss();
      const px = (spot.x - width / 2) / R;
      const py = (height / 2 - spot.y) / R;
      if (Math.hypot(px, py) <= 1.15) engine.pulse(1, Math.atan2(py, px));
    },
    onLeave: () => {
      pointer.inside = false;
      start();
    },
  };
  const unsubscribe = subscribePointer(pointerSub);
  const syncPointer = () => {
    pointerSub.active = visible && settings.interactive && !settings.reducedMotion;
    if (!pointerSub.active) pointer.inside = false;
  };

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
    // The intro plays the first time the orb scrolls into view.
    if (visible) introStarted = true;
    syncPointer();
    start();
  });
  intersectionObserver.observe(container);
  resize();

  const engine: OrbEngine = {
    update(next) {
      const introChanged = next.intro !== settings.intro;
      settings = next;
      if (introChanged && !next.intro) introT = INTRO_SECONDS;
      retargetColor(next);
      syncPointer();
      dirty = true;
      start();
    },
    pulse(strength = 1, angle) {
      if (!alive || settings.reducedMotion) return;
      const k = clamp(Number.isFinite(strength) ? strength : 1, 0, 2);
      if (k <= 0) return;
      surge = Math.min(2, surge + k * 0.85);
      const has = angle !== undefined && Number.isFinite(angle);
      kick.x = has ? Math.cos(angle) : 0;
      kick.y = has ? Math.sin(angle) : 0;
      kick.age = 0;
      kick.strength = k;
      spawnSpark(has ? angle : undefined, 1 + 0.3 * k);
      spawnSpark(has ? angle + 0.5 * (Math.random() < 0.5 ? -1 : 1) : undefined, 1 + 0.2 * k);
      start();
    },
    spark(angle) {
      if (!alive || settings.reducedMotion) return;
      spawnSpark(angle, 1.15);
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
      dust?.mesh.geometry.remove();
      triangle.remove();
      glowProgram.remove();
      dustProgram.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
  return engine;
}
