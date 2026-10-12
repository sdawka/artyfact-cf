/**
 * AmbientField engine: a full-bleed haze pool and sparse drifting motes in the Orb's dust/haze style. Built to stay
 * cheap on integrated GPUs: DPR capped at 1 (and a pixel budget), at most 3000 points, no offscreen passes, 30 fps while
 * only drifting, and no frames at all while hidden, offscreen, paused or motionless.
 */
import { Geometry, Mesh, Program, Renderer, Triangle } from "ogl";
import { clamp, fromOklab, parseColor, seeded, toOklab, type Rgb } from "../color";
import { stepNumbers, stepVector } from "../interpolate";
import { createContext } from "../support";
import { subscribePointer, type PointerSubscriber } from "../pointer";
import { hazeFragment, hazeVertex, MAX_RIPPLES, motesFragment, motesVertex } from "./shaders";

const FALLBACK_RGB: Rgb = [0.96, 0.66, 0.42];
/** About 2560×1440 at DPR 1. */
const PIXEL_BUDGET = 3.7e6;
const RIPPLE_SPEED = 520;
const RIPPLE_LIFE = 1.6;
const DRIFT_FPS = 30;

export const MIN_MOTES = 200;
export const MAX_MOTES = 3000;
/** Mote count for a density 0..1. */
export const motesForDensity = (density: number) => Math.round(MIN_MOTES + clamp(density, 0, 1) * (MAX_MOTES - MIN_MOTES));

export interface AmbientEngineSettings {
  color: string;
  /** 0..1, eases. */
  intensity: number;
  /** 0..1 → 200..3000 motes. Rebuilds; does not ease. */
  density: number;
  /** Drift speed multiplier, eases. 0 stops the loop. */
  motion: number;
  /** Pointer parallax, 0..1. */
  parallax: number;
  paused: boolean;
  reducedMotion: boolean;
  /** Easing time constant in seconds; 0 snaps. */
  transition: number;
}

export interface AmbientEngine {
  update(settings: AmbientEngineSettings): void;
  /** Ripple from viewport (client) coordinates. */
  pulse(clientX?: number, clientY?: number, strength?: number): void;
  dispose(): void;
}

export function createAmbientEngine(container: HTMLElement, initial: AmbientEngineSettings, onLost?: () => void): AmbientEngine | null {
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

  const ripples = new Array<number>(MAX_RIPPLES * 4).fill(0);
  const shared = {
    uSize: { value: [1, 1] }, uTime: { value: 0 }, uIntensity: { value: 0.5 }, uParallax: { value: [0, 0] },
    uColor: { value: [1, 1, 1] as Rgb }, uRipples: { value: ripples }, uRippleSpeed: { value: RIPPLE_SPEED }, uRippleLife: { value: RIPPLE_LIFE },
  };
  const hazeProgram = new Program(gl, { vertex: hazeVertex, fragment: hazeFragment, uniforms: shared, transparent: true, depthTest: false, depthWrite: false });
  hazeProgram.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const triangle = new Triangle(gl);
  const haze = new Mesh(gl, { geometry: triangle, program: hazeProgram });
  const motesProgram = new Program(gl, {
    vertex: motesVertex, fragment: motesFragment, uniforms: { ...shared, uDpr: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false,
  });
  motesProgram.setBlendFunc(gl.ONE, gl.ONE);

  let motes: { count: number; mesh: Mesh } | null = null;
  const rebuildMotes = (density: number) => {
    const count = motesForDensity(density);
    if (motes?.count === count) return;
    motes?.mesh.geometry.remove();
    const random = seeded(2718);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = random();
      seeds[i * 4 + 1] = random();
      seeds[i * 4 + 2] = Math.pow(random(), 1.6); // most motes far away, a few close
      seeds[i * 4 + 3] = random();
    }
    motes = { count, mesh: new Mesh(gl, { mode: gl.POINTS, geometry: new Geometry(gl, { aSeed: { size: 4, data: seeds } }), program: motesProgram }) };
  };

  let settings = initial;
  const eased = { intensity: initial.intensity, motion: initial.motion, parallax: initial.parallax };
  let colorKey = "";
  let colorTarget: number[] = [];
  const colorNow: number[] = [];
  const retargetColor = (s: AmbientEngineSettings) => {
    if (s.color === colorKey) return;
    colorKey = s.color;
    colorTarget = toOklab(parseColor(s.color, FALLBACK_RGB));
  };
  retargetColor(initial);
  colorNow.push(...colorTarget);

  let width = 1;
  let height = 1;
  let raf = 0;
  let last = performance.now();
  let lastDraw = 0;
  let time = 0;
  let visible = true;
  let alive = true;
  let dirty = true;
  const born: number[] = new Array<number>(MAX_RIPPLES).fill(-1);
  const pointer = { x: 0, y: 0, inside: false };
  const look = { x: 0, y: 0 };

  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.dpr = Math.min(1, window.devicePixelRatio || 1, Math.sqrt(PIXEL_BUDGET / (width * height)));
    renderer.setSize(width, height);
    dirty = true;
    start();
  };

  const frame = (now: number) => {
    raf = 0;
    if (!alive) return;
    const s = settings;
    const dt = Math.min(0.1, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    const reduced = s.reducedMotion;
    const tau = reduced ? 0 : Math.max(0, s.transition);
    const easing = stepNumbers(eased, { intensity: clamp(s.intensity, 0, 1), motion: Math.max(0, s.motion), parallax: clamp(s.parallax, 0, 1) }, dt, tau);
    const colorMoving = stepVector(colorNow, colorTarget, dt, tau);
    const drifting = !s.paused && !reduced && eased.motion > 0.001;

    if (drifting) time += dt * eased.motion;
    // Parallax follows the pointer with a soft spring, centred on the field.
    const gx = pointer.inside && !reduced ? clamp((pointer.x / width) * 2 - 1, -1, 1) * eased.parallax : 0;
    const gy = pointer.inside && !reduced ? clamp((pointer.y / height) * 2 - 1, -1, 1) * eased.parallax : 0;
    const k = 1 - Math.exp(-dt / 0.6);
    look.x += (gx - look.x) * k;
    look.y += (gy - look.y) * k;
    const parallaxMoving = Math.hypot(gx - look.x, gy - look.y) > 0.001;

    let rippling = false;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      if (born[i]! < 0) continue;
      const age = (now - born[i]!) / 1000;
      if (age >= RIPPLE_LIFE) {
        born[i] = -1;
        ripples[i * 4 + 3] = 0;
      } else {
        ripples[i * 4 + 2] = age;
        rippling = true;
      }
    }

    // While only drifting, draw at 30 fps: the motion is slow enough that nobody can tell, and it halves GPU time.
    const urgent = dirty || easing || colorMoving || parallaxMoving || rippling;
    if (urgent || now - lastDraw >= 1000 / DRIFT_FPS - 4) {
      lastDraw = now;
      dirty = false;
      rebuildMotes(s.density);
      shared.uSize.value = [width, height];
      shared.uTime.value = time;
      shared.uIntensity.value = eased.intensity;
      shared.uParallax.value = [look.x, look.y];
      shared.uColor.value = fromOklab(colorNow as [number, number, number]);
      motesProgram.uniforms.uDpr.value = renderer.dpr;
      gl.clearColor(0, 0, 0, 0);
      renderer.render({ scene: haze, clear: true });
      if (motes) renderer.render({ scene: motes.mesh, clear: false });
    }

    if (visible && (drifting || urgent)) raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf || !visible || !alive || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const pointerSub: PointerSubscriber = {
    element: container,
    active: true,
    onMove: (spot) => {
      pointer.x = spot.x;
      pointer.y = spot.y;
      pointer.inside = spot.inside;
      if (settings.parallax > 0) start();
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
      settings = next;
      retargetColor(next);
      dirty = true;
      start();
    },
    pulse(clientX, clientY, strength = 1) {
      if (!alive || settings.reducedMotion) return;
      const rect = container.getBoundingClientRect();
      const x = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const y = clientY === undefined ? rect.height / 2 : clientY - rect.top;
      // Reuse a free slot, else the oldest ripple.
      let slot = born.findIndex((b) => b < 0);
      if (slot < 0) slot = born.indexOf(Math.min(...born));
      born[slot] = performance.now();
      ripples[slot * 4] = x;
      ripples[slot * 4 + 1] = y;
      ripples[slot * 4 + 2] = 0;
      ripples[slot * 4 + 3] = clamp(strength, 0, 2);
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
      motes?.mesh.geometry.remove();
      triangle.remove();
      hazeProgram.remove();
      motesProgram.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
