import {
  HandState,
  Finger,
  BuildType,
  FINGER_ORDER,
  CONTROLS_FINGER_ORDER,
  PRESET_POSES,
  defaultState,
  cleanPose,
  clampStateToLimits,
  sanitizeHandState,
  cRange,
  rRange,
  calcA,
  reach,
  norm,
  clamp,
  runIk,
  jointPos,
  getActiveFingers,
  R,
} from './core.ts';
import { handMarkup } from './render.ts';
import {
  interpolatePose,
  squareViewBox,
  makeMeasurer,
  frameMarkup,
  buildSvgDocument,
  canvasFromMarkup,
  canvasBlob,
  downloadBlob,
  buildSequence,
  gifFrame,
  gifIndices,
  gifHeader,
  encodeApng,
  compressPngPixels,
  zipStore,
} from './export.ts';

export interface FpsMode {
  id: string;
  name: string;
  fps: number;
  label: string;
  title: string;
}

export const FPS_MODES: FpsMode[] = [
  { id: 'brad', name: 'Brad', fps: 8, label: '8F', title: 'Brad mode (8 FPS cutout)' },
  { id: 'lotte', name: 'Lotte', fps: 12, label: '12F', title: 'Lotte mode (12 FPS Reiniger)' },
  { id: 'anime', name: 'Anime', fps: 15, label: '15F', title: 'Anime mode (15 FPS)' },
  { id: 'walt', name: 'Walt', fps: 24, label: '24F', title: 'Walt mode (24 FPS Golden Age)' },
  { id: 'pure', name: 'Pure', fps: 60, label: '60F', title: 'Pure mode (60 FPS Native)' },
];

export function mountGotzPuppyt(container: HTMLElement): () => void {
  const NEUTRAL = 'Flat';
  const STORE = 'gotz.puppyt.v2';
  const LEGACY = 'pyxl.hand.v2';
  const BUILDS: [BuildType, string, string][] = [
    ['standard', '5F', 'Full Hand'],
    ['claw', '2F', 'Claw'],
    ['trident', '3F', 'Trident'],
    ['mickey', '4F', "Mickey's Glove"],
  ];
  // Descriptive Hand Pose Language (Thumb - Index, Bird, Ring, Pinky):
  // | for straight (< 20°), \ for tilted (20°-60°), ] for square rotations (>= 60°)
  function digitSymbol(curlDeg: number): string {
    if (curlDeg < 20) return '|';
    if (curlDeg < 60) return '\\';
    return ']';
  }

  function getPoseLanguage(st: HandState): string {
    const avg = (d: Finger) => (st.cj[d][0] + st.cj[d][1] + st.cj[d][2]) / 3;
    const t = digitSymbol(avg('thumb'));
    const i = digitSymbol(avg('index'));
    const b = digitSymbol(avg('middle')); // Bird
    const r = digitSymbol(avg('ring'));
    const p = digitSymbol(avg('pinky'));
    return `${t} - ${i}${b}${r}${p}`;
  }

  const copy = <T>(o: T): T => structuredClone(o);
  const enc = (s: string) => new TextEncoder().encode(s);
  const el = (tag: string, a: Record<string, any> = {}, ...kids: (Node | string)[]) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(a)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };
  const btn = (label: string | Node, onclick?: (e: MouseEvent) => void, a: Record<string, any> = {}) =>
    el('button', { ...(onclick ? { onclick } : {}), ...a }, label);

  // Framerate state - Lotte 12 FPS default!
  let currentFpsMode: FpsMode = FPS_MODES[1]; // Lotte
  let currentFps = currentFpsMode.fps; // 12
  let frameInterval = 1000 / currentFps; // 83.33ms

  // Build the initial DOM skeleton inside the container with builds, framerate toggles, and timeline
  container.innerHTML = `
    <header>
      <div class="hdr-top">
        <b>Gotz.Puppyt</b><i>v2</i>
        <span class="seg" id="builds" title="Hand configuration"></span>
        <span class="seg" id="fps-modes" title="Framerate mode: Brad (8), Lotte (12), Anime (15), Walt (24), Pure (60)"></span>
        <span class="seg">
          <button class="u" id="hu" title="Undo (Ctrl+Z)">Undo</button>
          <button class="r" id="hr" title="Redo (Ctrl+Y)">Redo</button>
        </span>
        <span class="sp"></span>
        <button id="hq" title="Reference">Help</button>
        <button id="th" title="Toggle dark / light">Theme</button>
      </div>
      <div id="timeline">
        <div class="tl-left">
          <button id="tl-play" class="tl-btn" title="Play / Pause pose timeline">Play</button>
          <button id="tl-loop" class="tl-btn on" title="Toggle loop">Loop</button>
          <span id="tl-time" class="tl-time">0% · 0.00s</span>
          <span style="color:var(--mut);font-size:10px">FROM:</span>
          <select id="tl-from" class="tl-select"></select>
          <button id="tl-swap" class="tl-btn" title="Swap From and To poses" style="padding:0 5px">Swap</button>
          <span style="color:var(--mut);font-size:10px">MID:</span>
          <select id="tl-mid" class="tl-select"></select>
          <span style="color:var(--mut);font-size:10px">TO:</span>
          <select id="tl-to" class="tl-select"></select>
        </div>

        <div class="tl-track-container" id="tl-track" title="Drag left/right to scrub · Drag up/down to set easing curve · Double-click to reset straight line">
          <svg class="tl-svg" id="tl-svg">
            <line class="tl-base-line" id="tl-guide" x1="14" y1="20" x2="280" y2="20" />
            <g id="tl-frame-ticks"></g>
            <path class="tl-curve-line" id="tl-line" d="M 14 20 L 280 20" />
            <circle class="tl-node" id="tl-node-start" cx="14" cy="20" r="4.5" title="Start pose (0%)" />
            <circle class="tl-node" id="tl-node-mid" cx="147" cy="20" r="4" title="Mid / Pass pose (50%)" />
            <circle class="tl-node" id="tl-node-end" cx="280" cy="20" r="4.5" title="End pose (100%)" />
            <g id="tl-head-group">
              <circle class="tl-head-outer" id="tl-head" cx="14" cy="20" r="7" />
              <circle class="tl-head-inner" cx="14" cy="20" r="2.5" />
            </g>
          </svg>
          <div class="tl-tooltip" id="tl-tip" hidden>0% · LINEAR</div>
        </div>

        <div class="tl-right">
          <button id="tl-onion" class="tl-btn" title="Toggle Onion Skinning (Ghosted blurred gray pose outlines)">Onion</button>
          <button id="tl-onion-depth" class="tl-btn" title="Onion skin history depth (Click to cycle 1..4 poses)">Depth: 2</button>
          <span id="tl-ease-badge" class="tl-badge" title="Click to reset to straight line (Linear)">Linear</span>
          <button id="tl-set-start" class="tl-btn" title="Pin current canvas pose as Start pose">Pin Start</button>
          <button id="tl-set-mid" class="tl-btn" title="Pin current canvas pose as Mid/Passing pose">Pin Mid</button>
          <button id="tl-set-end" class="tl-btn" title="Pin current canvas pose as End pose">Pin End</button>
        </div>
      </div>
    </header>
    <div id="stage">
      <svg id="s" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="parentJointGrad">
            <stop offset="0" stop-color="#ffff33"/>
            <stop offset=".35" stop-color="#adff2f"/>
            <stop offset=".7" stop-color="#65a30d"/>
            <stop offset="1" stop-color="#15803d"/>
          </radialGradient>
          <filter id="filmBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation=".0055"/>
          </filter>
          <filter id="ghostBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation=".02"/>
          </filter>
        </defs>
        <g id="grid"></g>
        <g id="pose-base"></g>
        <g id="onion-history"></g>
        <g id="onion-prev" class="onion-ghost prev"></g>
        <g id="onion-mid" class="onion-ghost mid"></g>
        <g id="onion-next" class="onion-ghost next"></g>
        <g id="hand" filter="url(#filmBlur)"></g>
      </svg>
      <div id="toast" hidden></div>
      <div id="info"></div>
    </div>
    <div id="c"></div>
    <div id="help" hidden>
      <div>
        <h3>Gotz.Puppyt Hand Rig v2</h3>
        <b>Drag on the canvas</b>
        <ul>
          <li><b>Red wrist hub:</b> rotate the whole hand.</li>
          <li><b>Finger root / base:</b> swing a finger about the wrist.</li>
          <li><b>Bone shaft or joint pin:</b> 14-pass CCD inverse kinematics toward the pointer.</li>
        </ul>
        <b>Descriptive Pose Language (Thumb - Index, Bird, Ring, Pinky)</b>
        <ul>
          <li><b>|</b> : Straight digit (&lt; 20° curl).</li>
          <li><b>\\</b> : Tilted digit (20°–60° curl).</li>
          <li><b>]</b> : Square rotation (≥ 60° bent / 90° square curl).</li>
          <li><b>Format:</b> <code>Thumb - Index, Bird, Ring, Pinky</code> (e.g. <code>|-||||</code> = flat, <code>]-]]]]</code> = fist, <code>]-|]]]</code> = pointing).</li>
        </ul>
        <b>Framerate Modes (Animation matches toggle everywhere)</b>
        <ul>
          <li><b>Brad (8 FPS):</b> Cutout animation, stepped cadence.</li>
          <li><b>Lotte (12 FPS):</b> Reiniger silhouette motion (Default).</li>
          <li><b>Anime (15 FPS):</b> Limited animation pacing.</li>
          <li><b>Walt (24 FPS):</b> Theatrical Golden Age animation.</li>
          <li><b>Pure (60 FPS):</b> Unthrottled native web framerate.</li>
        </ul>
        <b>Pose Timeline</b>
        <ul>
          <li><b>Straight line:</b> Represents linear progression from Start to End pose.</li>
          <li><b>Drag up/down:</b> Bends the line to set easing (Ease Out / In-Out up, Ease In down).</li>
          <li><b>Drag left/right:</b> Scrubs pose progression in real time.</li>
        </ul>
        <b>Builds</b>
        <ul>
          <li><b>Full</b> 5 digits · <b>Claw</b> index + thumb · <b>Trident</b> bird, ring, thumb · <b>Mickey's</b> no pinky.</li>
        </ul>
        <b>Space</b> saves the current pose as a numbered 1024×1024 PNG. Undo / redo: Ctrl+Z, Ctrl+Y / Cmd+Shift+Z.
        <p><button id="hx" class="on">Got It</button></p>
      </div>
    </div>
  `;

  const $ = <T extends HTMLElement | SVGElement>(s: string) => container.querySelector(s) as T;
  const svg = $<SVGSVGElement>('#s');
  const hand = $<SVGGElement>('#hand');
  const stage = $<HTMLDivElement>('#stage');
  const poseBase = $<SVGGElement>('#pose-base');

  let showBend = false;
  let S: HandState = defaultState();
  let sel = NEUTRAL;
  let hist: HandState[] = [copy(S)];
  let hi = 0;
  let anim = 0;
  let frozen = false;
  let preview: { orig: HandState; raf?: number } | null = null;
  let busy = false;
  const sync: (() => void)[] = [];

  const load = (): Record<string, any> => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? localStorage.getItem(LEGACY) ?? '{}');
    } catch {
      return {};
    }
  };
  const saved: Record<string, any> = load();
  let savedRev = 0;
  const persist = () => {
    savedRev++;
    try {
      localStorage.setItem(STORE, JSON.stringify(saved, null, 2));
    } catch {
      // storage unavailable
    }
  };

  const keep = (s: HandState) => ({
    expert: s.expert,
    fullElasticity: s.fullElasticity,
    o: s.o,
    wscale: s.wscale,
    boxes: s.boxes,
    skin: s.skin,
    build: s.build,
    ikPerFinger: s.ikPerFinger,
    wholeIk: s.wholeIk,
  });
  const isCustom = (k: string) => k in saved && !(k in PRESET_POSES);
  const poseState = (k: string): HandState => {
    const raw = PRESET_POSES[k] ?? saved[k];
    return raw ? sanitizeHandState({ ...defaultState(), ...cleanPose(raw), ...keep(S) }) : copy(S);
  };
  const same = (a: HandState, b: HandState) => JSON.stringify(cleanPose(a)) === JSON.stringify(cleanPose(b));

  let tt: any;
  const toast = (m: string, ms = 1800) => {
    const t = $<HTMLDivElement>('#toast');
    if (!t) return;
    t.textContent = m;
    t.hidden = false;
    clearTimeout(tt);
    tt = setTimeout(() => {
      t.hidden = true;
    }, ms);
  };

  const updHist = () => {
    container.querySelectorAll<HTMLButtonElement>('.u').forEach((b) => (b.disabled = hi <= 0));
    container.querySelectorAll<HTMLButtonElement>('.r').forEach((b) => (b.disabled = hi >= hist.length - 1));
  };

  let onionHistory: HandState[] = [copy(defaultState())];
  let onionDepth = 2; // Default 2 history poses

  function commit(s = S) {
    if (same(hist[hi], s)) return;
    hist = hist.slice(0, hi + 1);
    hist.push(copy(s));
    if (hist.length > 60) hist.shift();
    hi = hist.length - 1;

    // Record pose history for onion skin depth display
    if (!onionHistory.length || !same(onionHistory[onionHistory.length - 1], s)) {
      onionHistory.push(copy(s));
      if (onionHistory.length > 10) onionHistory.shift();
    }

    markOnionSkinDirty();
    updHist();
  }

  function glide(target: HandState, ms = 320) {
    cancelAnimationFrame(anim);
    const from = copy(S);
    const t0 = performance.now();
    let lastGlideTick = 0;
    const tick = (now: number) => {
      if (currentFps >= 60 || now - lastGlideTick >= frameInterval) {
        lastGlideTick = now;
        const p = Math.min(1, (now - t0) / ms);
        S = p < 1 ? interpolatePose(from, target, 0.5 - 0.5 * Math.cos(p * Math.PI)) : copy(target);
        draw();
      }
      if (performance.now() - t0 < ms) {
        anim = requestAnimationFrame(tick);
      } else {
        S = copy(target);
        draw();
      }
    };
    anim = requestAnimationFrame(tick);
  }

  const apply = (t: HandState, ms = 320, msg?: string) => {
    commit(t);
    glide(t, ms);
    if (msg) toast(msg);
  };

  const stepHist = (d: number) => {
    const i = hi + d;
    if (i < 0 || i >= hist.length) return;
    hi = i;
    updHist();
    glide(hist[hi]);
    toast(d < 0 ? 'Undo' : 'Redo', 1200);
  };

  const applyPose = (k: string) => {
    sel = k;
    apply(poseState(k));
    refresh();
  };

  function savePose(quick: boolean) {
    let defaultName = $name.value.trim();
    if (!defaultName) {
      let i = 1;
      while (saved['Pose ' + i]) i++;
      defaultName = 'Pose ' + i;
    }
    const inputName = prompt('Enter name for saved pose:', defaultName);
    if (inputName === null) return; // User canceled
    const n = inputName.trim() || defaultName;
    saved[n] = cleanPose(S);
    persist();
    sel = n;
    $name.value = '';
    refresh();
    toast(`Saved "${n}"`, 2200);
  }

  function delPose() {
    if (!isCustom(sel)) return toast('Cannot delete default or preset poses', 2200);
    const n = sel;
    delete saved[n];
    persist();
    applyPose(NEUTRAL);
    toast(`Deleted "${n}"`, 2200);
  }

  function mirror() {
    const t = copy(S);

    // 1. Global rotation, tilt, and splay negation
    t.wrist = norm(-t.wrist);
    t.tilt = -t.tilt;
    t.splay = -t.splay;

    // 2. Swaps between Symmetrical Finger Pairs across vertical center axis (X = 0)
    // Center digit (Middle): stays in place, rotation negated
    t.rot.middle = -t.rot.middle;

    // Pair A: Index (left) <-> Ring (right)
    const idxCj = [...t.cj.index] as [number, number, number];
    const ringCj = [...t.cj.ring] as [number, number, number];
    t.cj.index = ringCj;
    t.cj.ring = idxCj;

    const idxRot = t.rot.index;
    const ringRot = t.rot.ring;
    t.rot.index = -ringRot;
    t.rot.ring = -idxRot;

    const idxFs = t.fs.index ?? 0;
    const ringFs = t.fs.ring ?? 0;
    t.fs.index = -ringFs;
    t.fs.ring = -idxFs;

    const idxIk = t.ikPerFinger?.index ?? true;
    const ringIk = t.ikPerFinger?.ring ?? true;
    if (!t.ikPerFinger) t.ikPerFinger = { ...defaultState().ikPerFinger };
    t.ikPerFinger.index = ringIk;
    t.ikPerFinger.ring = idxIk;

    // 3. Pinky (right digit): negate rotation and finger splay offset
    t.rot.pinky = -t.rot.pinky;
    t.fs.pinky = -(t.fs.pinky ?? 0);

    // 4. Thumb (outer radial digit): negate thumb splay and thumb rotation while preserving all 3 thumb joint flexions!
    const [thRLo, thRHi] = rRange('thumb', t.expert, t.fullElasticity);
    t.thumb = clamp(-t.thumb, -100, 100);
    t.rot.thumb = clamp(-t.rot.thumb, thRLo, thRHi);
    const [thCLo, thCHi] = cRange('thumb', t.expert);
    t.cj.thumb = t.cj.thumb.map((v) => clamp(v, thCLo, thCHi)) as [number, number, number];

    apply(t, 350, 'Mirrored Pose');
  }

  function curl(dl: number) {
    const t = copy(S);
    for (const d of FINGER_ORDER) {
      const [lo, hi2] = cRange(d, t.expert);
      t.cj[d] = t.cj[d].map((v) => clamp(v + dl, lo, hi2)) as [number, number, number];
    }
    apply(t, 220, dl > 0 ? `Curled +${dl}\xB0` : `Extended ${dl}\xB0`);
  }

  function shuffle() {
    const t = copy(S);
    const rnd = (n: number) => Math.floor(Math.random() * n);
    for (const d of FINGER_ORDER) {
      const [cl, ch] = cRange(d, t.expert);
      const [rl, rh] = rRange(d, t.expert);
      const b = rnd(ch - cl) + cl;
      t.cj[d] = [0, 1, 2].map(() => clamp(b + rnd(20) - 10, cl, ch)) as [number, number, number];
      t.rot[d] = clamp(Math.round(rnd((rh - rl) * 0.5) + rl * 0.25), rl, rh);
    }
    t.splay = clamp(rnd(60) - 20, -50, 70);
    apply(t, 320, 'Randomized natural gesture');
  }

  function setBuild(id: BuildType) {
    S.build = id;
    commit();
    draw();
  }

  const cycleBuild = () => {
    const b = BUILDS[(BUILDS.findIndex((x) => x[0] === S.build) + 1) % 4];
    setBuild(b[0]);
    toast('Build: ' + b[2], 2000);
  };

  // FPS Mode controller
  function setFpsMode(id: string) {
    const found = FPS_MODES.find((m) => m.id === id);
    if (!found) return;
    currentFpsMode = found;
    currentFps = found.fps;
    frameInterval = currentFps >= 60 ? 0 : 1000 / currentFps;

    // Keep animation flyout select in sync
    if ($fps) $fps.value = String(currentFps);

    sync.forEach((f) => f());
    toast(`Framerate: ${found.name} (${found.fps} FPS)`, 1800);
  }

  const cycleFpsMode = () => {
    const idx = FPS_MODES.findIndex((m) => m.id === currentFpsMode.id);
    const next = FPS_MODES[(idx + 1) % FPS_MODES.length];
    setFpsMode(next.id);
  };

  const reset = () => {
    sel = NEUTRAL;
    apply(poseState(NEUTRAL), 320, 'Reset to Flat');
    refresh();
  };

  let onionSkin = false;
  let onionSkinDirty = true;
  let poseBaseInit = false;
  const onionHistGroup = $<SVGGElement>('#onion-history');
  const onionPrevGroup = $<SVGGElement>('#onion-prev');
  const onionMidGroup = $<SVGGElement>('#onion-mid');
  const onionNextGroup = $<SVGGElement>('#onion-next');

  function markOnionSkinDirty() {
    onionSkinDirty = true;
  }

  function updateOnionSkinGhosts() {
    if (!onionSkin) {
      if (onionHistGroup) { onionHistGroup.style.display = 'none'; onionHistGroup.innerHTML = ''; }
      if (onionPrevGroup) { onionPrevGroup.style.display = 'none'; onionPrevGroup.innerHTML = ''; }
      if (onionMidGroup) { onionMidGroup.style.display = 'none'; onionMidGroup.innerHTML = ''; }
      if (onionNextGroup) { onionNextGroup.style.display = 'none'; onionNextGroup.innerHTML = ''; }
      onionSkinDirty = false;
      return;
    }

    if (!onionSkinDirty) return;
    onionSkinDirty = false;

    if (onionHistGroup) {
      const histPoses = onionHistory.slice(0, Math.max(0, onionHistory.length - 1)).slice(-onionDepth);
      let histMarkup = '';
      histPoses.forEach((st, idx) => {
        const op = (0.2 + ((idx + 1) / Math.max(1, histPoses.length)) * 0.45).toFixed(2);
        histMarkup += `<g class="onion-ghost history" transform="rotate(${st.wrist})" style="opacity:${op}">${handMarkup(st, false, false)}</g>`;
      });
      onionHistGroup.innerHTML = histMarkup;
      onionHistGroup.style.display = '';
    }

    const fromSt = poseState(tlFromPose);
    const toSt = poseState(tlToPose);

    if (onionPrevGroup) {
      onionPrevGroup.setAttribute('transform', `rotate(${fromSt.wrist})`);
      onionPrevGroup.innerHTML = handMarkup(fromSt, false, false);
      onionPrevGroup.style.display = '';
    }

    if (tlMidPose && tlMidPose !== '(Blank)' && tlMidPose !== '' && onionMidGroup) {
      const midSt = poseState(tlMidPose);
      onionMidGroup.setAttribute('transform', `rotate(${midSt.wrist})`);
      onionMidGroup.innerHTML = handMarkup(midSt, false, false);
      onionMidGroup.style.display = '';
    } else if (onionMidGroup) {
      onionMidGroup.style.display = 'none';
      onionMidGroup.innerHTML = '';
    }

    if (onionNextGroup) {
      onionNextGroup.setAttribute('transform', `rotate(${toSt.wrist})`);
      onionNextGroup.innerHTML = handMarkup(toSt, false, false);
      onionNextGroup.style.display = '';
    }
  }

  function draw() {
    if (poseBase) {
      if (!poseBaseInit) {
        poseBase.innerHTML = `<line class="pose-base-line" x1="-35" y1="0" x2="35" y2="0"/><title>Stage Base Line (Pink reference horizon at wrist y=0)</title>`;
        poseBaseInit = true;
      }
    }

    if (onionSkinDirty) {
      updateOnionSkinGhosts();
    }

    hand.setAttribute('transform', `rotate(${S.wrist})`);
    hand.innerHTML = handMarkup(S, true, showBend);
    fit();
    sync.forEach((f) => f());
  }

  function getHandMaxY(st: HandState): number {
    let maxY = 0;
    const active = getActiveFingers(st.build);
    for (const d of active) {
      const pts = jointPos(d, st);
      for (const p of pts) {
        if (p.y > maxY) maxY = p.y;
      }
    }
    return maxY;
  }

  const lockedViewDim = 11.5;
  let cachedViewBox = '';

  function fit() {
    const r = stage.getBoundingClientRect();
    const w = r.width || window.innerWidth || 800;
    const h = r.height || window.innerHeight || 600;
    const asp = Math.max(0.2, w / h);

    const bh = lockedViewDim;
    const dw = asp >= 1 ? bh * asp : bh;
    const dh = asp >= 1 ? bh : bh / asp;

    // LOCKED BASE POSITION: The wrist is ALWAYS positioned where it is when the menu is out (baseOffset = 0.80).
    // Zero camera movement or shift when the bottom menu minimizes or maximizes!
    const baseOffset = 0.80;
    let dy = -dh + baseOffset;

    // Camera is static when above pink line (y <= 0.30). Beneath pink line begins camera movement:
    // If lower plane poses extend deeper than the wrist base (handMaxY > 0.30), camera moves down:
    const handMaxY = getHandMaxY(S);
    if (handMaxY > 0.30) {
      dy += (handMaxY - 0.30);
    }

    cachedViewBox = `-${dw / 2} ${dy} ${dw} ${dh}`;
    svg.setAttribute('viewBox', cachedViewBox);
  }

  const gridEl = $<SVGGElement>('#grid');
  if (gridEl) {
    gridEl.innerHTML = Array.from({ length: 41 }, (_, i) => i - 20)
      .map(
        (n) =>
          `<line class="${n === 0 ? 'axis' : n % 5 === 0 ? 'g-major' : 'g-unit'}" x1="${n}" y1="-20" x2="${n}" y2="20"/><line class="${
            n === 0 ? 'axis' : n % 5 === 0 ? 'g-major' : 'g-unit'
          }" x1="-20" y1="${n}" x2="20" y2="${n}"/>`
      )
      .join('');
  }

  let drag: any = null;
  let inv: DOMMatrix | null = null;
  let lastDragTime = 0;
  let dragPendingCoords: { clientX: number; clientY: number } | null = null;
  let dragTimer: any = null;

  function processDrag(clientX: number, clientY: number) {
    if (!drag || !inv) return;
    const { x, y } = new DOMPoint(clientX, clientY).matrixTransform(inv);
    const a = Math.atan2(x, -y) / R;

    if (drag.w) {
      // LOCK Q1: Wrist clamp [-75, 75] default, unlocks to [-180, 180] on expert/fullElasticity
      const [wLo, wHi] = S.expert || S.fullElasticity ? [-180, 180] : [-75, 75];
      S.wrist = Math.round(clamp(norm(a), wLo, wHi));
    } else if (drag.isJointPin) {
      // LOCK Q3: Joint dot = pin that knuckle, stays clamped
      const d = drag.d as Finger;
      const k = drag.k;
      if (k === 0) {
        const [lo, hi2] = rRange(d, S.expert, S.fullElasticity);
        S.rot[d] = Math.round(clamp(norm(a - (S.wrist + calcA(d, S) - S.rot[d])), lo, hi2));
      } else {
        const cjIdx = Math.min(2, Math.max(0, k - 1));
        const [cLo, cHi] = cRange(d, S.expert);
        const positions = jointPos(d, S);
        const parentPos = k === 1 ? { x: 0, y: 0, phi: S.wrist + calcA(d, S) } : positions[k - 2];
        const localAngle = (Math.atan2(x - parentPos.x, -(y - parentPos.y)) / R) - parentPos.phi;
        S.cj[d][cjIdx] = Math.round(clamp(norm(localAngle), cLo, cHi));
      }
    } else {
      // LOCK Q3: Bone rect drag = tip-driven IK mimicking real finger mechanics
      S = runIk(drag.d as Finger, drag.k, x, y, S);
    }
    draw();
  }

  type FingerTab = Finger | 'all';
  let activeTab: FingerTab = 'index';

  const FINGER_TABS: { id: FingerTab; label: string }[] = [
    { id: 'index', label: 'Index' },
    { id: 'middle', label: 'Bird' },
    { id: 'ring', label: 'Ring' },
    { id: 'pinky', label: 'Pinky' },
    { id: 'thumb', label: 'Thumb' },
    { id: 'all', label: 'All' },
  ];

  const fingerGroupEls: Partial<Record<Finger, HTMLElement>> = {};
  const tabButtons: Record<string, HTMLButtonElement> = {};

  let $menuLabel: HTMLElement | null = null;
  let $menuReach: HTMLElement | null = null;

  interface ToggleBox {
    container: HTMLElement;
    btn: HTMLButtonElement;
    wrapper: HTMLElement;
    range: HTMLInputElement;
    num: HTMLElement;
    isOpen: () => boolean;
    open: () => void;
    close: () => void;
    update: (val: number, rangeLo: number, rangeHi: number) => void;
  }

  let toggleBoxes: ToggleBox[] = [];
  let tglBoxMeta: ToggleBox | null = null;
  let tglBoxFinger: ToggleBox | null = null;
  let tglBoxGrip: ToggleBox | null = null;
  let tglBoxTip: ToggleBox | null = null;

  function createRotationToggleBox(
    type: 'meta' | 'finger' | 'grip' | 'tip',
    label: string
  ): ToggleBox {
    const container = el('div', { class: 'rot-tgl-box' });
    const btn = el(
      'button',
      { class: 'rot-tgl-btn', title: `Click to open live slider for ${label}` },
      `${label}: 0\xB0`
    ) as HTMLButtonElement;

    const nameSpan = el('span', { class: 'rot-tgl-name' }, label);
    const range = el('input', { type: 'range', class: 'rot-tgl-range' }) as HTMLInputElement;
    const num = el('span', { class: 'rot-tgl-num' }, '0\xB0');
    const closeBtn = el('button', { class: 'rot-tgl-x', title: 'Close slider' }, '\xD7');

    const wrapper = el('div', { class: 'rot-tgl-slider-wrapper', hidden: '' }, nameSpan, range, num, closeBtn);
    container.append(btn, wrapper);

    let openState = false;

    const open = () => {
      openState = true;
      btn.hidden = true;
      wrapper.hidden = false;
      range.focus();
    };

    const close = () => {
      openState = false;
      wrapper.hidden = true;
      btn.hidden = false;
    };

    btn.onclick = () => {
      toggleBoxes.forEach((tb) => {
        if (tb.container !== container) tb.close();
      });
      open();
    };

    closeBtn.onclick = () => close();

    let userDragging = false;
    range.onpointerdown = () => {
      userDragging = true;
    };
    range.onpointerup = range.onpointercancel = () => {
      userDragging = false;
      commit();
    };

    range.oninput = () => {
      const v = Number(range.value) || 0;
      num.textContent = `${Math.round(v)}\xB0`;

      const targets = activeTab === 'all' ? getActiveFingers(S.build) : [activeTab as Finger];
      targets.forEach((f) => {
        if (type === 'meta') {
          const [lo, hi2] = rRange(f, S.expert, S.fullElasticity);
          S.rot[f] = clamp(v, lo, hi2);
        } else {
          const jIdx = type === 'finger' ? 0 : type === 'grip' ? 1 : 2;
          const [lo, hi2] = cRange(f, S.expert);
          S.cj[f][jIdx] = clamp(v, lo, hi2);
        }
      });
      draw();
    };

    const tb: ToggleBox = {
      container,
      btn,
      wrapper,
      range,
      num,
      isOpen: () => openState,
      open,
      close,
      update: (val: number, rangeLo: number, rangeHi: number) => {
        btn.textContent = `${label}: ${Math.round(val)}\xB0`;
        range.min = String(rangeLo);
        range.max = String(rangeHi);
        if (!userDragging && document.activeElement !== range) {
          range.value = String(val);
          num.textContent = `${Math.round(val)}\xB0`;
        }
      },
    };
    toggleBoxes.push(tb);
    return tb;
  }

  function updateTopHeaderAndToggles() {
    const target = activeTab;
    const active = getActiveFingers(S.build);

    if (target === 'all') {
      if ($menuLabel) $menuLabel.textContent = 'ALL FINGERS';
      if ($menuReach) $menuReach.textContent = 'Reach: 5.0 - 8.0 pyxls';
    } else {
      const labelText = target === 'middle' ? 'BIRD' : target.toUpperCase();
      if ($menuLabel) $menuLabel.textContent = labelText;
      if ($menuReach) $menuReach.textContent = `Reach: ${reach(target, S.o)} pyxls`;
    }

    const targets = target === 'all' ? active : [target as Finger];
    const firstTarget = targets[0] ?? 'index';

    const avgRot = targets.reduce((acc, f) => acc + (S.rot[f] ?? 0), 0) / (targets.length || 1);
    const avgJ0 = targets.reduce((acc, f) => acc + (S.cj[f]?.[0] ?? 0), 0) / (targets.length || 1);
    const avgJ1 = targets.reduce((acc, f) => acc + (S.cj[f]?.[1] ?? 0), 0) / (targets.length || 1);
    const avgJ2 = targets.reduce((acc, f) => acc + (S.cj[f]?.[2] ?? 0), 0) / (targets.length || 1);

    const [rLo, rHi] = rRange(firstTarget, S.expert, S.fullElasticity);
    const [cLo, cHi] = cRange(firstTarget, S.expert);

    if (tglBoxMeta) tglBoxMeta.update(avgRot, rLo, rHi);
    if (tglBoxFinger) tglBoxFinger.update(avgJ0, cLo, cHi);
    if (tglBoxGrip) tglBoxGrip.update(avgJ1, cLo, cHi);
    if (tglBoxTip) tglBoxTip.update(avgJ2, cLo, cHi);
  }

  function updateFingerTabs() {
    for (const [id, b] of Object.entries(tabButtons)) {
      b.classList.toggle('on', id === activeTab);
    }
    for (const d of FINGER_ORDER) {
      const card = fingerGroupEls[d];
      if (card) {
        card.style.display = activeTab === 'all' || activeTab === d ? '' : 'none';
      }
    }
    updateTopHeaderAndToggles();
  }

  svg.onpointerdown = (e: PointerEvent) => {
    // 1. Immediately pause timeline playback or active animations to eliminate
    // double-hit jitter and state fighting during rapid pose-to-pose transitions:
    if (tlPlaying) stopTimeline();
    if (preview) {
      if (preview.raf) cancelAnimationFrame(preview.raf);
      preview = null;
      if ($pv) $pv.textContent = '|> Preview transition';
    }
    cancelAnimationFrame(anim);

    inv = svg.getScreenCTM()?.inverse() ?? null;
    if (!inv) return;

    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    const t = e.target as HTMLElement;
    const ds = t.dataset;
    const g = t.closest?.('[data-d]') as HTMLElement | null;

    // Wrist hub detection: socket center is at (0, 0)
    const wristDist = Math.hypot(pt.x, pt.y);

    // Direct hit check on a dedicated joint pin or fingertip circle
    const directJoint = ds.d && ds.j !== undefined && (ds.hit === 'joint' || ds.hit === 'tip');

    const active = getActiveFingers(S.build);

    // 2. High-precision geometric hit resolution with 51-49 child priority:
    interface HitCandidate {
      d: Finger;
      k: number;
      dist: number;
      isChild: boolean;
      priorityScore: number;
    }

    let bestCandidate: HitCandidate | null = null;

    for (const d of active) {
      // Tab priority bias: if user is on an individual finger tab, slightly bias
      // against accidental adjacent finger jumps in border zones
      const isTabActive = activeTab !== 'all' && activeTab === d;
      const tabBias = isTabActive ? 0.92 : 1.0;

      const positions = jointPos(d, S); // [0: knuckle, 1: middle joint, 2: tip joint, 3: fingertip]
      const pts = [{ x: 0, y: 0 }, ...positions];

      // A. Evaluate exact joint pins (knuckle 0, PIP 1, DIP 2, tip 3)
      positions.forEach((pos, idx) => {
        const dJoint = Math.hypot(pt.x - pos.x, pt.y - pos.y);
        // Child priority: child joints (idx > 0) get 51-49 split weighting (49/51 factor)
        const isChildJoint = idx > 0;
        const score = (isChildJoint ? dJoint * (49 / 51) : dJoint) * tabBias;

        if (
          !bestCandidate ||
          score < bestCandidate.priorityScore - 1e-5 ||
          (Math.abs(score - bestCandidate.priorityScore) <= 1e-5 && idx > bestCandidate.k)
        ) {
          bestCandidate = {
            d,
            k: idx,
            dist: dJoint,
            isChild: isChildJoint,
            priorityScore: score,
          };
        }
      });

      // B. Evaluate bone shaft segments (metacarpal 0, proximal 1, middle 2, distal 3)
      for (let s = 0; s < 4; s++) {
        const pA = pts[s];
        const pB = pts[s + 1];
        const vx = pB.x - pA.x;
        const vy = pB.y - pA.y;
        const lenSq = vx * vx + vy * vy;
        if (lenSq < 1e-6) continue;

        const wx = pt.x - pA.x;
        const wy = pt.y - pA.y;
        const tParam = clamp((wx * vx + wy * vy) / lenSq, 0, 1);
        const projX = pA.x + tParam * vx;
        const projY = pA.y + tParam * vy;
        const dShaft = Math.hypot(pt.x - projX, pt.y - projY);

        // 51-49 split along the bone shaft:
        // Parametric t >= 0.49 maps to child joint s (joint at pB)
        // Parametric t < 0.49 maps to parent joint max(0, s - 1)
        const mapsToChild = tParam >= 0.49;
        const targetJoint = mapsToChild ? s : Math.max(0, s - 1);

        // Score with 51-49 child priority and subtle distance along shaft
        const score =
          (mapsToChild ? dShaft * (49 / 51) : dShaft) * tabBias + (1 - tParam) * 0.04;

        if (dShaft < 0.7) {
          if (
            !bestCandidate ||
            score < bestCandidate.priorityScore - 1e-5 ||
            (Math.abs(score - bestCandidate.priorityScore) <= 1e-5 && targetJoint > bestCandidate.k)
          ) {
            bestCandidate = {
              d,
              k: targetJoint,
              dist: dShaft,
              isChild: mapsToChild,
              priorityScore: score,
            };
          }
        }
      }
    }

    if (directJoint && ds.d && ds.j !== undefined) {
      // User directly clicked a dedicated joint pin or fingertip circle
      drag = {
        d: ds.d as Finger,
        k: +ds.j,
        isJointPin: ds.hit === 'joint',
      };
    } else if (bestCandidate && bestCandidate.dist < 1.45) {
      // Geometric resolution with 51-49 child priority
      drag = {
        d: bestCandidate.d,
        k: bestCandidate.k,
        isJointPin: bestCandidate.isChild === false && bestCandidate.dist < 0.28,
      };
    } else if (ds.w || (wristDist < 0.35 && (!bestCandidate || bestCandidate.dist > 0.45))) {
      // Explicit wrist hub drag to rotate the whole hand
      drag = { w: 1 };
    } else if (g && g.dataset.d) {
      const fallbackFinger = g.dataset.d as Finger;
      const targetJoint = bestCandidate && bestCandidate.d === fallbackFinger ? bestCandidate.k : 3;
      drag = { d: fallbackFinger, k: targetJoint, isJointPin: false };
    } else {
      drag = null;
    }

    if (!drag) return;
    if (drag.d && activeTab !== 'all') {
      activeTab = drag.d as FingerTab;
      updateFingerTabs();
    }
    frozen = true;
    cancelAnimationFrame(anim);
    svg.setPointerCapture(e.pointerId);
    lastDragTime = performance.now();
  };

  // Dragging framerate strictly follows the active FPS toggle!
  svg.onpointermove = (e: PointerEvent) => {
    if (!drag || !inv) return;
    const now = performance.now();
    dragPendingCoords = { clientX: e.clientX, clientY: e.clientY };

    if (currentFps >= 60) {
      // Pure mode: immediate smooth RAF processing
      processDrag(e.clientX, e.clientY);
    } else if (now - lastDragTime >= frameInterval) {
      lastDragTime = now;
      if (dragTimer) {
        clearTimeout(dragTimer);
        dragTimer = null;
      }
      processDrag(e.clientX, e.clientY);
    } else if (!dragTimer) {
      const remaining = Math.max(0, frameInterval - (now - lastDragTime));
      dragTimer = setTimeout(() => {
        dragTimer = null;
        lastDragTime = performance.now();
        if (dragPendingCoords && drag) {
          processDrag(dragPendingCoords.clientX, dragPendingCoords.clientY);
        }
      }, remaining);
    }
  };

  svg.onpointerup = svg.onpointercancel = () => {
    if (!drag) return;
    if (dragTimer) {
      clearTimeout(dragTimer);
      dragTimer = null;
    }
    if (dragPendingCoords) {
      processDrag(dragPendingCoords.clientX, dragPendingCoords.clientY);
      dragPendingCoords = null;
    }
    drag = null;
    frozen = !!preview;
    commit();
    fit();
  };

  const resizeObserver = new ResizeObserver(() => {
    inv = svg.getScreenCTM()?.inverse() ?? null;
    fit();
    renderTimeline();
  });
  resizeObserver.observe(stage);

  svg.ondblclick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.id === 's' || target.id === 'stage' || target.id === 'grid') {
      fit();
      toast('Reset stage camera view', 1200);
    }
  };

  const typing = (t: HTMLElement) =>
    /^(textarea|select)$/i.test(t.tagName) || (t.tagName === 'INPUT' && !/^(range|button)$/.test((t as HTMLInputElement).type));
  const spaceKey = (e: KeyboardEvent) =>
    e.code === 'Space' &&
    !typing(e.target as HTMLElement) &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    $<HTMLDivElement>('#help')?.hidden;

  const onKeyDown = (e: KeyboardEvent) => {
    if (spaceKey(e)) {
      e.preventDefault();
      if (e.repeat) return;
      if ((e.target as HTMLElement).tagName === 'BUTTON') (e.target as HTMLElement).blur();
      snapPng();
      return;
    }
    if (/^(input|textarea|select)$/i.test((e.target as HTMLElement).tagName) || !(e.ctrlKey || e.metaKey) || e.altKey)
      return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      e.preventDefault();
      stepHist(k === 'y' || e.shiftKey ? 1 : -1);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (spaceKey(e)) e.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function slider(
    label: string,
    unit: string,
    range: () => [number, number],
    get: () => number,
    set: (v: number) => void
  ) {
    const r = el('input', { type: 'range' }) as HTMLInputElement;
    const n = el('input', { type: 'number' }) as HTMLInputElement;
    const put = (v: string | number) => {
      const [lo, hi2] = range();
      set(clamp(Number(v) || 0, lo, hi2));
      draw();
    };
    r.oninput = () => put(r.value);
    n.oninput = () => put(n.value);
    r.onchange = n.onchange = () => commit();
    sync.push(() => {
      const [lo, hi2] = range();
      const v = get();
      for (const i of [r, n]) {
        i.min = String(lo);
        i.max = String(hi2);
        if (document.activeElement !== i) i.value = String(v);
      }
    });
    return el('div', { class: 'row' }, el('label', {}, label), r, n, el('span', { class: 'u' }, unit));
  }

  function check(label: string, note: string, get: () => boolean, set: (v: boolean) => void) {
    const c = el('input', { type: 'checkbox' }) as HTMLInputElement;
    c.onchange = () => {
      set(c.checked);
      draw();
      commit();
    };
    sync.push(() => (c.checked = get()));
    return el('label', { class: 'chk' }, c, label, el('small', {}, note));
  }

  const flies: Record<string, HTMLElement> = {};
  function fly(id: string, side: 'l' | 'r', title: string, ...kids: (Node | string)[]) {
    const f = el(
      'div',
      { class: `fly ${side}`, hidden: '' },
      el('h2', {}, title, btn('Close', () => show(id))),
      ...kids
    ) as HTMLElement;
    flies[id] = f;
    stage.append(f);
    return f;
  }

  function show(id: string) {
    const open = flies[id].hidden;
    for (const f of Object.values(flies)) f.hidden = true;
    flies[id].hidden = !open;
    sync.forEach((f) => f());
  }

  const tbtn = (label: string | Node, title: string, fn?: (e: MouseEvent) => void, a: Record<string, any> = {}) =>
    btn(label, fn, { title, ...a });

  const section = (title: string, icon: string, open: boolean, ...kids: (Node | string)[]) => {
    const d = el(
      'details',
      { class: 'sec' },
      el('summary', {}, `${icon} ${title}`, el('small', { class: 'bdg', hidden: '' }), el('i', { class: 'chev' }, 'v')),
      el('div', { class: 'col' }, ...kids)
    ) as HTMLDetailsElement;
    d.open = open;
    return d;
  };

  const badge = (d: HTMLElement, n?: string | number) => {
    const b = d.querySelector('.bdg') as HTMLElement;
    if (b) {
      b.textContent = n !== undefined ? String(n) : '';
      b.hidden = n === undefined;
    }
  };

  const $name = el('input', { type: 'text', placeholder: 'Pose name (empty = auto #)' }) as HTMLInputElement;
  const $q = el('input', { type: 'text', placeholder: 'Search poses\u2026' }) as HTMLInputElement;
  let cat = 'all';
  const $presets = el('div', { class: 'pl' });
  const $mine = el('div', { class: 'pl' });
  const $json = el('textarea', { placeholder: 'Paste JSON pose or click Export JSON\u2026' }) as HTMLTextAreaElement;
  const chips = ['all', 'presets', 'saved'].map((c) =>
    btn(
      (c === 'all' ? 'All' : c === 'presets' ? 'Canonical' : 'Custom') as string,
      () => {
        cat = c;
        refresh();
      },
      { 'data-c': c }
    )
  );
  const selMorph = el('select') as HTMLSelectElement;
  const selFrom = el('select') as HTMLSelectElement;
  const selTo = el('select') as HTMLSelectElement;
  const $del = btn('Delete', delPose) as HTMLButtonElement;
  const secMine = section(
    'User Saved Poses',
    '[*]',
    true,
    $mine,
    el('div', { class: 'r2' }, $name, btn('Save', () => savePose(false)), $del)
  );

  const tlFromSelect = $<HTMLSelectElement>('#tl-from');
  const tlMidSelect = $<HTMLSelectElement>('#tl-mid');
  const tlToSelect = $<HTMLSelectElement>('#tl-to');

  const $quickList = el('div', { class: 'col', style: 'gap:6px' });

  function refresh() {
    const t = $q.value.trim().toLowerCase();
    const hit = (k: string) => !t || k.toLowerCase().includes(t);
    const fill = (box: HTMLElement, keys: string[], empty: string, cls: string) => {
      const ks = keys.filter(hit);
      box.replaceChildren(
        ...ks.map((k) => {
          const p = poseState(k);
          const lang = getPoseLanguage(p);
          const row = el(
            'div',
            { class: 'pose-row' },
            el('span', { class: 'pose-txt' }, k),
            el('span', { class: 'pose-code' }, lang)
          );
          return btn(row, () => applyPose(k), {
            class: 'pose' + cls + (k === sel ? ' on' : ''),
            title: `${k} (Thumb - Index, Bird, Ring, Pinky: ${lang})`,
          });
        })
      );
      if (!ks.length) box.textContent = empty;
      return ks.length;
    };
    fill($presets, cat === 'saved' ? [] : Object.keys(PRESET_POSES), 'No matching presets', '');
    badge(
      secMine,
      fill(
        $mine,
        cat === 'presets' ? [] : Object.keys(saved),
        Object.keys(saved).length ? 'No matching poses' : 'No user poses saved yet',
        ' me'
      )
    );
    chips.forEach((b) => b.classList.toggle('on', b.dataset.c === cat));

    const allPoses = [
      ...Object.keys(PRESET_POSES),
      ...Object.keys(saved),
    ];
    $quickList.replaceChildren(
      ...allPoses.map((k) => {
        const lang = getPoseLanguage(poseState(k));
        const btnLabel = k.length > 8 ? k.slice(0, 7) + '\u2026' : k;
        return tbtn(btnLabel, `${k} (Thumb - Index, Bird, Ring, Pinky: ${lang})`, () => applyPose(k), {
          class: k === sel ? 'on' : '',
          'data-q': k,
        });
      })
    );

    const allDropdowns = [selMorph, selFrom, selTo, tlFromSelect, tlMidSelect, tlToSelect].filter(Boolean) as HTMLSelectElement[];
    for (const s of allDropdowns) {
      const v = s.value;
      const isMid = s === tlMidSelect;
      const options = [
        ...(isMid ? [el('option', { value: '(Blank)' }, '(Blank)')] : []),
        ...[
          ['Presets', Object.keys(PRESET_POSES)],
          ['Saved', Object.keys(saved)],
        ]
          .filter((g) => (g[1] as string[]).length)
          .map(([l, ks]) =>
            el('optgroup', { label: l as string }, ...(ks as string[]).map((k) => el('option', { value: k }, k)))
          ),
      ];
      s.replaceChildren(...options);
      s.value = [...s.options].some((o) => o.value === v)
        ? v
        : isMid
        ? (v || '(Blank)')
        : s === selMorph || s === selTo || s === tlToSelect
        ? (Object.keys(saved)[0] ?? NEUTRAL)
        : NEUTRAL;
    }
    container.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === sel));
    $del.disabled = !isCustom(sel);
    renderTimeline();
  }
  $q.oninput = refresh;

  fly(
    'lib',
    'l',
    'Pose Library',
    $q,
    el('div', { class: 'r2' }, ...chips),
    section('Quick Pose Presets', '[P]', true, $presets),
    secMine,
    section(
      'JSON Pose Data',
      '{}',
      false,
      el(
        'div',
        { class: 'r2' },
        btn('Export JSON', () => ($json.value = JSON.stringify(cleanPose(S), null, 2))),
        btn('Import JSON', () => {
          try {
            apply(
              clampStateToLimits({ ...defaultState(), ...cleanPose(JSON.parse($json.value)), ...keep(S) }),
              320,
              'Pose JSON loaded'
            );
          } catch {
            toast('Invalid JSON pose data', 2500);
          }
        })
      ),
      $json
    )
  );

  let morphBase: HandState | null = null;
  let morphAmt = 0;
  const $mv = el('span', {}, '0%');
  const $mr = el('input', {
    type: 'range',
    min: 0,
    max: 100,
    value: 0,
    style: 'width:100%;accent-color:var(--acc)',
  }) as HTMLInputElement;

  const morphZero = () => {
    $mr.value = '0';
    morphAmt = 0;
    $mv.textContent = '0%';
  };
  $mr.oninput = () => {
    morphAmt = +$mr.value;
    $mv.textContent = morphAmt + '%';
    const stFrom = poseState(selFrom.value);
    const stTo = poseState(selTo.value);
    S = interpolatePose(stFrom, stTo, morphAmt / 100);
    draw();
  };
  selFrom.onchange = selTo.onchange = morphZero;

  const btnSetStart = btn(
    'Set',
    () => {
      const n = 'Start Pose';
      saved[n] = cleanPose(S);
      persist();
      refresh();
      selFrom.value = n;
      if (tlFromSelect) tlFromSelect.value = n;
      morphZero();
      toast('Set current pose as Start Pose', 1800);
    },
    { title: 'Set current canvas pose as Start Pose' }
  );

  const btnSetTarget = btn(
    'Set',
    () => {
      const n = 'Target Pose';
      saved[n] = cleanPose(S);
      persist();
      refresh();
      selTo.value = n;
      if (tlToSelect) tlToSelect.value = n;
      morphZero();
      toast('Set current pose as Target Pose', 1800);
    },
    { title: 'Set current canvas pose as Target Pose' }
  );

  const btnSwapPoses = btn(
    '\u21C4 Swap Poses',
    () => {
      const tmp = selFrom.value;
      selFrom.value = selTo.value;
      selTo.value = tmp;
      if (tlFromSelect) tlFromSelect.value = selFrom.value;
      if (tlToSelect) tlToSelect.value = selTo.value;
      morphZero();
      sync.forEach((f) => f());
      toast('Swapped Start & Target poses', 1500);
    },
    { title: 'Swap Start and Target poses' }
  );

  fly(
    'pose2pose',
    'l',
    'Pose to Pose Morph',
    section(
      'Start & Target Pose Morph Scrub',
      '[~]',
      true,
      el('div', { class: 'r2', style: 'grid-template-columns: 1fr auto; align-items: center;' }, el('label', {}, 'Start Pose'), btnSetStart),
      selFrom,
      el('div', { class: 'r2', style: 'grid-template-columns: 1fr auto; align-items: center; margin-top: 6px;' }, el('label', {}, 'Target Pose'), btnSetTarget),
      selTo,
      el('div', { class: 'r2', style: 'margin-top: 6px;' }, btnSwapPoses),
      el('div', { class: 'r2', style: 'margin-top: 8px;' }, el('span', {}, 'Morph amount'), $mv),
      $mr,
      el(
        'div',
        { class: 'r2', style: 'margin-top: 8px;' },
        btn('Commit morph', () => {
          commit();
          morphZero();
          toast('Morph applied', 1800);
        }),
        btn('Reset', () => {
          morphZero();
          reset();
        })
      )
    )
  );

  fly(
    'rig',
    'r',
    'Hand Rig',
    section(
      'Bird Reference Tilt',
      '[!]',
      false,
      slider(
        'Bird tilt',
        '\xB0',
        () => [-30, 30],
        () => S.tilt,
        (v) => (S.tilt = v)
      )
    ),
    section(
      'Rig Options & Toggles',
      '[CFG]',
      false,
      check(
        '360\xB0 Wrist Hub ',
        '(unlocks \xB1180\xB0 range)',
        () => S.expert || S.fullElasticity,
        (v) => {
          S.expert = v;
          S = clampStateToLimits(S);
          draw();
          commit();
        }
      ),
      check(
        'Whole-hand IK ',
        '(dragged bone guides entire hand)',
        () => S.wholeIk,
        (v) => {
          S.wholeIk = v;
          commit();
        }
      ),
      check(
        'Expert mode ',
        '(unconstrained \xB190\xB0)',
        () => S.expert,
        (v) => {
          S.expert = v;
          S = clampStateToLimits(S);
        }
      ),
      check(
        'Full elasticity ',
        '(unconstrained metacarpals)',
        () => S.fullElasticity,
        (v) => {
          S.fullElasticity = v;
          S = clampStateToLimits(S);
          draw();
        }
      ),
      check(
        'Knuckle overlap ',
        '(0.5 / end-to-end)',
        () => S.o > 0,
        (v) => (S.o = v ? 0.5 : 0)
      ),
      check(
        'Scale widths ',
        '(by SUM\u2212KN / 7)',
        () => S.wscale,
        (v) => (S.wscale = v)
      ),
      check(
        'Handpiece art ',
        '(all five digits)',
        () => S.skin,
        (v) => (S.skin = v)
      ),
      check(
        'Show bend arrows ',
        '(lime = curl, red = hyperextension)',
        () => showBend,
        (v) => (showBend = v)
      ),
      check(
        'Show bone & palm boxes ',
        '(4:1, 2:1, 1:1, 1:1 + 12.5% margins)',
        () => S.boxes,
        (v) => (S.boxes = v)
      ),
      check(
        'Onion skin keyframes ',
        '(ghosted cyan start & magenta end pose outlines)',
        () => onionSkin,
        (v) => {
          onionSkin = v;
          const b = $<HTMLButtonElement>('#tl-onion');
          if (b) b.classList.toggle('on', onionSkin);
          draw();
        }
      )
    )
  );

  const $stem = el('input', { type: 'text', value: 'gotz-puppyt' }) as HTMLInputElement;
  const stem = () => $stem.value.trim() || 'gotz-puppyt';

  const guard = (fn: () => Promise<void>) => async () => {
    if (busy || preview) return;
    busy = true;
    try {
      await fn();
    } catch (e: any) {
      toast(`Export failed: ${e.message || e}`, 4000);
    } finally {
      busy = false;
      progress();
    }
  };

  const $snaps = el('div', { id: 'snaps' });
  stage.append($snaps);

  function deliver(blob: Blob, name: string) {
    downloadBlob(blob, name);
    const url = URL.createObjectURL(blob);
    const isImg = blob.type.startsWith('image/');
    const card = el('div', { class: 'snap' });
    const close = () => {
      URL.revokeObjectURL(url);
      card.remove();
    };
    const copy2 = el(
      'button',
      {
        onclick: async () => {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            toast('Copied to clipboard', 1500);
          } catch {
            toast('Copy is blocked here: use Save, or long-press / right-click the picture', 3200);
          }
        },
      },
      'Copy'
    );
    card.append(
      isImg ? el('img', { src: url, alt: name }) : el('span', { class: 'ico' }, '[PKG]'),
      el(
        'div',
        { class: 'col' },
        el('b', {}, name),
        el(
          'small',
          {},
          isImg ? 'Nothing downloaded? Long-press / right-click the picture, or:' : 'Nothing downloaded? Use Save:'
        ),
        el(
          'div',
          { class: 'r2' },
          el('a', { href: url, download: name }, 'Save'),
          ...(blob.type === 'image/png' ? [copy2] : []),
          btn('Dismiss', close, { title: 'Dismiss' })
        )
      )
    );
    $snaps.append(card);
    while ($snaps.children.length > 3) {
      ($snaps.firstElementChild?.querySelector('button:last-child') as HTMLButtonElement)?.click();
    }
  }

  const $bar = el('div', { class: 'bar', hidden: '' }, el('i')) as HTMLElement;
  const $stage = el('small', {}) as HTMLElement;
  function progress(stageText?: string, cur?: number, tot?: number) {
    $bar.hidden = !stageText;
    if (stageText && cur !== undefined && tot !== undefined) {
      $stage.textContent = `${stageText} ${cur}/${tot}`;
      ($bar.firstChild as HTMLElement).style.width = Math.round((cur / tot) * 100) + '%';
    } else {
      $stage.textContent = '';
    }
  }

  async function stillMarkup() {
    const markup = frameMarkup(S);
    const m = makeMeasurer();
    try {
      return { markup, vb: squareViewBox(m.measure(markup)) };
    } finally {
      m.destroy();
    }
  }

  const pngJob = (name: string) =>
    guard(async () => {
      const { markup, vb } = await stillMarkup();
      deliver(await canvasBlob(await canvasFromMarkup(markup, vb, 1024)), name);
      toast(`Exported ${name}`, 2500);
    });

  const savePng = () => pngJob(stem() + '.png')();
  let snaps = 0;
  const snapPng = () => {
    if (preview) return toast('Stop the preview first, then press Space', 2200);
    if (busy) return;
    toast('Saving PNG\u2026', 1200);
    pngJob(`${stem()}-${String(++snaps).padStart(3, '0')}.png`)();
  };

  const saveSvg = guard(async () => {
    const { markup, vb } = await stillMarkup();
    deliver(new Blob([buildSvgDocument(markup, vb, 1024)], { type: 'image/svg+xml;charset=utf-8' }), stem() + '.svg');
    toast(`Exported ${stem()}.svg`, 2500);
  });

  fly(
    'img',
    'r',
    'Save Pose Image',
    section(
      'Image Export Formats',
      '[IMG]',
      true,
      el('label', {}, 'Filename stem'),
      $stem,
      el(
        'div',
        { class: 'r2' },
        btn('Save PNG', savePng, { title: 'Transparent 1024\xD71024 PNG (Space saves one instantly)' }),
        btn('Save SVG', saveSvg, { title: 'Vector SVG' })
      )
    ),
    section(
      'Format Info & Resolution',
      '{}',
      false,
      el('small', {}, 'Centered 1024\xD71024 transparent export in the violet / lime palette.')
    )
  );

  const $dur = el('input', {
    type: 'range',
    min: 0.2,
    max: 4,
    step: 0.1,
    value: 1,
    style: 'accent-color:var(--acc)',
  }) as HTMLInputElement;
  const $durL = el('label', {}, 'Duration (1s)');

  // Synced export FPS dropdown
  const $fps = el(
    'select',
    {},
    ...FPS_MODES.map((m) => el('option', { value: String(m.fps) }, `${m.name} (${m.fps} fps)`))
  ) as HTMLSelectElement;
  $fps.value = String(currentFps);
  $fps.onchange = () => {
    const found = FPS_MODES.find((m) => String(m.fps) === $fps.value);
    if (found) setFpsMode(found.id);
  };

  const $pv = btn('|&gt; Preview transition', async () => {
    if (preview) {
      if (preview.raf) cancelAnimationFrame(preview.raf);
      S = preview.orig;
      preview = null;
      frozen = false;
      $pv.textContent = '|&gt; Preview transition';
      return draw();
    }
    if (busy) return;
    const from = poseState(selFrom.value);
    const to = poseState(selTo.value);
    preview = { orig: copy(S) };
    frozen = true;
    try {
      svg.setAttribute('viewBox', (await buildSequence(from, to, 12)).viewBox);
    } catch (e: any) {
      preview = null;
      frozen = false;
      return toast(`Preview failed: ${e.message || e}`, 3000);
    }
    const ms = Math.max(300, Number($dur.value) * 1000);
    const t0 = performance.now();
    let lastPreviewTick = 0;
    $pv.textContent = '[] Stop preview';
    const loop = (now: number) => {
      // Preview strictly steps according to the active framerate!
      if (currentFps >= 60 || now - lastPreviewTick >= frameInterval) {
        lastPreviewTick = now;
        const e = (now - t0) % (ms * 2);
        const l = e < ms ? e / ms : 2 - e / ms;
        S = interpolatePose(from, to, 0.5 - 0.5 * Math.cos(l * Math.PI));
        draw();
      }
      if (preview) {
        preview.raf = requestAnimationFrame(loop);
      }
    };
    preview.raf = requestAnimationFrame(loop);
  }) as HTMLButtonElement;

  // Captured animations always match the active FPS toggle!
  async function exportAnim(kind: 'gif' | 'apng' | 'zip') {
    const from = poseState(selFrom.value);
    const to = poseState(selTo.value);
    const fps = currentFps; // Strict match with active toggle
    const dur = +$dur.value;
    const n = Math.max(2, Math.round(dur * fps));
    const size = 512;
    const parts: any[] = [];
    const seq = await buildSequence(from, to, n, (c, t) => progress('Measuring frames', c, t));
    for (let i = 0; i < n; i++) {
      progress(`Rendering ${kind.toUpperCase()} frame (${currentFpsMode.name} ${fps} FPS)`, i + 1, n);
      const cv = await canvasFromMarkup(seq.frames[i].markup, seq.viewBox, size);
      const px = () => cv.getContext('2d')!.getImageData(0, 0, size, size).data;
      parts.push(
        kind === 'gif'
          ? gifFrame(gifIndices(new Uint8Array(px())), size, size, fps)
          : kind === 'apng'
          ? await compressPngPixels(new Uint8Array(px()), size, size)
          : new Uint8Array(await (await canvasBlob(cv)).arrayBuffer())
      );
    }
    let blob: Blob;
    let name: string;
    if (kind === 'gif') {
      blob = new Blob([...gifHeader(size, size), ...parts, Uint8Array.of(59)], { type: 'image/gif' });
      name = `-${currentFpsMode.id}-anim.gif`;
    } else if (kind === 'apng') {
      blob = encodeApng(parts, size, size, fps);
      name = `-${currentFpsMode.id}-anim.png`;
    } else {
      const files = parts.map((data, i) => ({ name: `frame_${String(i).padStart(3, '0')}.png`, data }));
      files.push({
        name: 'animation.json',
        data: enc(
          JSON.stringify(
            {
              app: 'Gotz.Puppyt Hand Rig v2',
              fpsMode: currentFpsMode.name,
              fps: currentFps,
              from: selFrom.value,
              to: selTo.value,
              durationSeconds: dur,
              frameCount: n,
              viewBox: seq.viewBox,
              frameNames: files.map((f) => f.name),
            },
            null,
            2
          )
        ),
      });
      blob = zipStore(files);
      name = `-${currentFpsMode.id}-frames.zip`;
    }
    deliver(blob, stem() + name);
    toast(`Exported ${stem()}${name} (${currentFps} FPS)`, 2500);
  }

  const expBtn = (label: string, kind: 'gif' | 'apng' | 'zip', title: string) =>
    btn(label, guard(() => exportAnim(kind)), { title });

  let frameIdx: number | null = null;
  let filmRev = 0;
  let filmSig = '';
  const $film = el('div', { class: 'film' });
  const $clear = btn(
    'Clear selection',
    () => {
      frameIdx = null;
      markFrame();
    },
    { hidden: '' }
  );
  const secFilm = section(
    'Keyframe Filmstrip Preview',
    '[*]',
    true,
    el('small', {}, 'Click a thumbnail to preview that frame on stage:'),
    $film,
    $clear
  );
  const markFrame = () => {
    $film.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === frameIdx));
    $clear.hidden = frameIdx === null;
  };

  async function filmstrip() {
    const rev = ++filmRev;
    const seq = await buildSequence(poseState(selFrom.value), poseState(selTo.value), 6);
    if (rev !== filmRev) return;
    $film.replaceChildren(
      ...seq.frames.map((f, i) => {
        const pct = Math.round((i / 5) * 100);
        const sec = ((i / 5) * Number($dur.value)).toFixed(2) + 's';
        const b = el('button', {
          title: `Frame ${pct}% (${sec}): click to preview on stage`,
          onclick: () => {
            if (preview) return;
            cancelAnimationFrame(anim);
            commit();
            frameIdx = i;
            S = copy(f.pose);
            draw();
            commit();
            markFrame();
            toast(`Previewing frame ${pct}% (${sec})`, 1500);
          },
        });
        b.innerHTML = `<svg viewBox="${seq.viewBox}">${f.markup}</svg><span>${pct}%</span><small>${sec}</small>`;
        return b;
      })
    );
    badge(secFilm, '6 frames');
    markFrame();
  }

  sync.push(() => {
    if (flies.anim.hidden) return;
    const sig = [selFrom.value, selTo.value, $dur.value, currentFps, JSON.stringify(keep(S)), savedRev].join('|');
    if (sig !== filmSig) {
      filmSig = sig;
      filmstrip().catch(() => {});
    }
  });

  selFrom.onchange = selTo.onchange = () => {
    frameIdx = null;
    sync.forEach((f) => f());
  };

  $dur.oninput = () => {
    $durL.textContent = `Duration (${$dur.value}s)`;
    sync.forEach((f) => f());
  };

  fly(
    'anim',
    'r',
    'Pose-to-Pose Animation',
    section('Transition Pose Selectors', '[FLM]', true, el('label', {}, 'From pose'), selFrom, el('label', {}, 'To pose'), selTo),
    secFilm,
    section('Timing & Live Preview', '[>]', true, $durL, $dur, el('label', {}, 'Framerate (Matches Active Toggle)'), $fps, $pv),
    section(
      'Export Animation Encoders',
      '[V]',
      true,
      el(
        'div',
        { class: 'r2' },
        expBtn('GIF', 'gif', 'Transparent animated GIF (matches active FPS)'),
        expBtn('APNG', 'apng', 'Full-colour animated PNG (matches active FPS)'),
        expBtn('ZIP', 'zip', 'Numbered PNG frames + animation.json')
      ),
      $bar,
      $stage,
      el('small', {}, 'Captured animations always render at the selected framerate (Brad 8, Lotte 12, Anime 15, Walt 24, Pure 60).')
    )
  );

  // Hand Build Button (5F standard / 2F claw / 3F trident / 4F mickey)
  const bldBtn = el('button', { class: 'bld', onclick: cycleBuild }) as HTMLButtonElement;

  // Framerate Toggle Button located directly beneath the hand build button!
  const fpsBtn = el('button', { class: 'bld', onclick: cycleFpsMode }) as HTMLButtonElement;

  sync.push(() => {
    const b = BUILDS.find((x) => x[0] === S.build) ?? BUILDS[0];
    bldBtn.title = `Build: ${b[2]}. Click for next.`;
    bldBtn.replaceChildren(el('b', {}, b[1]), b[0] === 'mickey' ? 'Mickey' : b[0]);

    fpsBtn.title = `Framerate: ${currentFpsMode.name} (${currentFps} FPS). Click to cycle: Brad (8) → Lotte (12) → Anime (15) → Walt (24) → Pure (60).`;
    fpsBtn.replaceChildren(el('b', {}, String(currentFps)), currentFpsMode.name);

    container.querySelectorAll('[data-fps]').forEach((b) =>
      b.classList.toggle('on', (b as HTMLElement).dataset.fps === currentFpsMode.id)
    );
  });

  stage.append(
    el(
      'div',
      { class: 'tb l' },
      tbtn('Library', 'Pose library & saved poses', () => show('lib')),
      tbtn('pose2pose', 'Pose to pose morph', () => show('pose2pose')),
      el('hr'),
      $quickList,
      el('hr'),
      tbtn('+15', 'Curl all fingers +15\xB0', () => curl(15)),
      tbtn('-15', 'Extend all fingers \u221215\xB0', () => curl(-15)),
      tbtn('Mirror', 'Mirror hand', mirror),
      tbtn('Shuffle', 'Randomize gesture', shuffle),
      tbtn('Reset', 'Reset to flat', reset)
    ),
    el(
      'div',
      { class: 'tb r' },
      tbtn('Controls', 'Precise pose & joint controls', () => show('ctrls')),
      el('hr'),
      bldBtn,
      fpsBtn, // Located directly beneath the hand toggle!
      el('hr'),
      tbtn('Settings', 'Hand rig settings', () => show('rig')),
      tbtn('Export', 'Save pose image', () => show('img')),
      tbtn('Animate', 'Pose-to-pose animation', () => show('anim'))
    )
  );

  const buildsEl = $<HTMLElement>('#builds');
  if (buildsEl) {
    buildsEl.append(
      ...BUILDS.map(([id, , label]) =>
        btn(id === 'mickey' ? "Mickey's" : id, () => setBuild(id), {
          'data-b': id,
          title: label,
          style: 'text-transform:capitalize',
        })
      )
    );
  }

  // Header segmented framerate mode buttons
  const fpsModesEl = $<HTMLElement>('#fps-modes');
  if (fpsModesEl) {
    fpsModesEl.append(
      ...FPS_MODES.map((mode) =>
        btn(mode.name, () => setFpsMode(mode.id), {
          'data-fps': mode.id,
          title: mode.title,
        })
      )
    );
  }

  async function copyPoseDataToClipboard() {
    const poseData = JSON.stringify(cleanPose(S), null, 2);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(poseData);
      } else {
        const ta = document.createElement('textarea');
        ta.value = poseData;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast('Copied full pose JSON data to clipboard!', 2200);
    } catch {
      toast('Failed to copy pose JSON data', 2000);
    }
  }

  function initBottomGuide() {
    const infoEl = $<HTMLElement>('#info');
    if (!infoEl) return;
    infoEl.innerHTML = '';
    infoEl.title = 'Double-click any value to copy full pose JSON data to clipboard';

    infoEl.ondblclick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      copyPoseDataToClipboard();
    };

    const createField = (
      label: string,
      unit: string,
      getVal: () => number,
      setVal: (v: number) => void,
      getBounds: () => [number, number],
      fingerId?: Finger
    ) => {
      const item = el('span', { class: `hud-item ${fingerId ? 'hud-digit-' + fingerId : ''}` });
      const lbl = el('span', { class: 'hud-lbl' }, label);
      const inp = el('input', {
        type: 'number',
        class: 'hud-input',
        step: '1',
        value: String(Math.round(getVal())),
        title: `${label} (${unit}): click or type to edit · double-click to copy full pose JSON`
      }) as HTMLInputElement;
      const unt = el('span', { class: 'hud-unit' }, unit);

      inp.ondblclick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        copyPoseDataToClipboard();
      };

      const commitChange = () => {
        const [lo, hi] = getBounds();
        const num = Number(inp.value);
        if (!isFinite(num)) return;
        const clamped = clamp(Math.round(num), lo, hi);
        inp.value = String(clamped);
        setVal(clamped);
        draw();
        commit();
      };

      inp.oninput = () => {
        const [lo, hi] = getBounds();
        const num = Number(inp.value);
        if (!isFinite(num)) return;
        setVal(clamp(Math.round(num), lo, hi));
        draw();
      };

      inp.onchange = () => commitChange();
      inp.onkeydown = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          inp.blur();
          commitChange();
        }
      };
      inp.onkeyup = (e: KeyboardEvent) => e.stopPropagation();

      item.append(lbl, inp, unt);

      return {
        item,
        inp,
        fingerId,
        sync: () => {
          if (fingerId) {
            const active = getActiveFingers(S.build).includes(fingerId);
            item.classList.toggle('off', !active);
          }
          if (document.activeElement !== inp) {
            inp.value = String(Math.round(getVal()));
          }
          const [lo, hi] = getBounds();
          inp.min = String(lo);
          inp.max = String(hi);
        }
      };
    };

    const wristField = createField(
      'Wrist',
      '°',
      () => S.wrist,
      (v) => (S.wrist = v),
      () => (S.expert || S.fullElasticity ? [-180, 180] : [-75, 75])
    );

    const splayField = createField(
      'Splay',
      '%',
      () => S.splay,
      (v) => (S.splay = v),
      () => [-100, 100]
    );

    const tiltField = createField(
      'Tilt',
      '°',
      () => S.tilt,
      (v) => (S.tilt = v),
      () => [-30, 30]
    );

    const thumbField = createField(
      'Thumb',
      '°',
      () => Math.round(S.cj.thumb.reduce((a, b) => a + b, 0) / 3),
      (v) => (S.cj.thumb = [v, v, v]),
      () => cRange('thumb', S.expert),
      'thumb'
    );

    const indexField = createField(
      'Index',
      '°',
      () => Math.round(S.cj.index.reduce((a, b) => a + b, 0) / 3),
      (v) => (S.cj.index = [v, v, v]),
      () => cRange('index', S.expert),
      'index'
    );

    const midField = createField(
      'Bird',
      '°',
      () => Math.round(S.cj.middle.reduce((a, b) => a + b, 0) / 3),
      (v) => (S.cj.middle = [v, v, v]),
      () => cRange('middle', S.expert),
      'middle'
    );

    const ringField = createField(
      'Ring',
      '°',
      () => Math.round(S.cj.ring.reduce((a, b) => a + b, 0) / 3),
      (v) => (S.cj.ring = [v, v, v]),
      () => cRange('ring', S.expert),
      'ring'
    );

    const pinkyField = createField(
      'Pinky',
      '°',
      () => Math.round(S.cj.pinky.reduce((a, b) => a + b, 0) / 3),
      (v) => (S.cj.pinky = [v, v, v]),
      () => cRange('pinky', S.expert),
      'pinky'
    );

    const hudBadge = el('span', { class: 'hud-badge', title: 'Descriptive pose code (Thumb - Index, Bird, Ring, Pinky). Double-click to copy pose JSON' }, getPoseLanguage(S));
    const hudFps = el('span', { class: 'hud-fps' }, `${currentFpsMode.name} (${currentFps} FPS)`);

    infoEl.append(
      wristField.item,
      splayField.item,
      tiltField.item,
      el('span', { class: 'hud-sep' }),
      thumbField.item,
      indexField.item,
      midField.item,
      ringField.item,
      pinkyField.item,
      el('span', { class: 'hud-sep' }),
      hudBadge,
      hudFps
    );

    const fields = [wristField, splayField, tiltField, thumbField, indexField, midField, ringField, pinkyField];

    sync.push(() => {
      fields.forEach((f) => f.sync());
      hudBadge.textContent = getPoseLanguage(S);
      hudFps.textContent = `${currentFpsMode.name} (${currentFps} FPS)`;
    });
  }

  initBottomGuide();

  sync.push(
    () => container.querySelectorAll('[data-b]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.b === S.build))
  );

  const hu = $<HTMLButtonElement>('#hu');
  if (hu) hu.onclick = () => stepHist(-1);
  const hr = $<HTMLButtonElement>('#hr');
  if (hr) hr.onclick = () => stepHist(1);
  const hq = $<HTMLButtonElement>('#hq');
  if (hq) hq.onclick = () => ($<HTMLDivElement>('#help')!.hidden = false);
  const hx = $<HTMLButtonElement>('#hx');
  if (hx) hx.onclick = () => ($<HTMLDivElement>('#help')!.hidden = true);

  const setTheme = (t: 'dark' | 'light') => {
    document.body.dataset.theme = t;
    const th = $<HTMLButtonElement>('#th');
    if (th) th.textContent = t === 'dark' ? 'Light Theme' : 'Dark Theme';
  };
  const th = $<HTMLButtonElement>('#th');
  if (th) th.onclick = () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  setTheme('dark');

  const menuHeader = el('div', { class: 'bottom-menu-header' });

  const tabBar = el('div', { class: 'finger-tab-bar' });
  FINGER_TABS.forEach((tab) => {
    const b = el(
      'button',
      {
        class: `ftab ${tab.id === 'all' ? 'all-tab' : ''} ${tab.id === activeTab ? 'on' : ''}`,
        onclick: () => {
          activeTab = tab.id;
          updateFingerTabs();
        },
      },
      tab.label
    ) as HTMLButtonElement;
    tabButtons[tab.id] = b;
    tabBar.append(b);
  });

  $menuLabel = el('span', { class: 'menu-finger-label' }, 'INDEX');
  $menuReach = el('span', { class: 'menu-finger-reach' }, 'Reach: 7.5 pyxls');
  const labelReachBox = el('div', { class: 'menu-label-reach' }, $menuLabel, $menuReach);

  tglBoxMeta = createRotationToggleBox('meta', 'Meta');
  tglBoxFinger = createRotationToggleBox('finger', 'Finger');
  tglBoxGrip = createRotationToggleBox('grip', 'Grip');
  tglBoxTip = createRotationToggleBox('tip', 'Tip');

  const togglesBox = el(
    'div',
    { class: 'toggles-group' },
    el('span', { class: 'toggles-title' }, 'ROTATION TOGGLES:'),
    tglBoxMeta.container,
    tglBoxFinger.container,
    tglBoxGrip.container,
    tglBoxTip.container
  );

  const subBar = el('div', { class: 'menu-sub-bar' }, labelReachBox, togglesBox);
  menuHeader.append(tabBar, subBar);

  const cardsGrid = el('div', { class: 'finger-cards-grid' });
  const CARD_ORDER: Finger[] = ['index', 'middle', 'ring', 'pinky', 'thumb'];

  for (const d of CARD_ORDER) {
    const mid = d === 'middle';
    const thFinger = d === 'thumb';
    const g = el('div', { class: `grp ${mid ? 'master-digit' : ''}` });
    fingerGroupEls[d] = g;

    const set3 = (i: number, v: number) => (S.cj[d][i] = v);
    const headerRow = el(
      'div',
      { class: 'digit-card-header' },
      el('h3', {}, mid ? 'Middle (Bird)' : d[0].toUpperCase() + d.slice(1)),
      mid ? el('span', { class: 'master-digit-badge', title: 'Master reference digit for all hand kinematics' }, 'MASTER') : ''
    );
    g.append(headerRow);
    if (!mid) {
      g.append(
        slider(
          'Splay add',
          '%',
          () => [-100, 100],
          () => (thFinger ? S.thumb : S.fs[d]),
          (v) => (thFinger ? (S.thumb = v) : (S.fs[d] = v))
        )
      );
    }
    g.append(
      slider(
        'Rotation',
        '\xB0',
        () => rRange(d, S.expert, S.fullElasticity),
        () => S.rot[d],
        (v) => (S.rot[d] = v)
      ),
      slider(
        'Curl (all)',
        '\xB0',
        () => cRange(d, S.expert),
        () => Math.round(S.cj[d].reduce((a, b) => a + b) / 3),
        (v) => (S.cj[d] = [v, v, v])
      ),
      el(
        'details',
        { open: '' },
        el('summary', {}, 'Joint curls (3 joints)'),
        el(
          'div',
          { class: 'col' },
          ...['Knuckle', 'Middle joint', 'Tip joint'].map((l, i) =>
            slider(
              l,
              '\xB0',
              () => cRange(d, S.expert),
              () => S.cj[d][i],
              (v) => set3(i, v)
            )
          )
        )
      ),
      check(
        'IK solver ',
        '(bone drag tip-IK)',
        () => S.ikPerFinger[d] ?? true,
        (v) => {
          S.ikPerFinger[d] = v;
          commit();
        }
      )
    );
    sync.push(() => {
      g.classList.toggle('off', !getActiveFingers(S.build).includes(d));
    });
    cardsGrid.append(g);
  }

  function createPosingWheel() {
    const card = el('div', { class: 'posing-wheel-card' });
    const title = el('span', { class: 'posing-wheel-title' }, 'WRIST POSING WHEEL');
    const valText = el('span', { class: 'posing-wheel-val' }, `${Math.round(S.wrist)}\xB0`);
    const header = el('div', { class: 'posing-wheel-header' }, title, valText);

    const wrap = el('div', { class: 'posing-wheel-wrap' });
    const wheelSvg = el('svg', { class: 'posing-wheel-svg', viewBox: '-50 -50 100 100' });

    // Render 12 radial ticks every 30 deg
    const ticksG = el('g', { class: 'posing-wheel-ticks' });
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      const x1 = Math.sin(rad) * 38;
      const y1 = -Math.cos(rad) * 38;
      const x2 = Math.sin(rad) * 44;
      const y2 = -Math.cos(rad) * 44;
      ticksG.append(el('line', { x1, y1, x2, y2 }));
    }

    const ring = el('circle', { class: 'posing-wheel-ring', r: 42, cx: 0, cy: 0 });
    const indicator = el('line', { class: 'posing-wheel-indicator', x1: 0, y1: 0, x2: 0, y2: -36 });
    const knob = el('circle', { class: 'posing-wheel-knob', r: 22, cx: 0, cy: 0 });
    const centerTxt = el('text', { class: 'posing-wheel-center-txt', x: 0, y: 0 }, `${Math.round(S.wrist)}\xB0`);

    wheelSvg.append(ticksG, ring, indicator, knob, centerTxt);
    wrap.append(wheelSvg);

    let isWheelDragging = false;

    const updateWheelPointer = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      indicator.setAttribute('x2', String(Math.sin(rad) * 36));
      indicator.setAttribute('y2', String(-Math.cos(rad) * 36));
      centerTxt.textContent = `${Math.round(deg)}\xB0`;
      valText.textContent = `${Math.round(deg)}\xB0 \xB7 Pose: ${getPoseLanguage(S)}`;
    };

    wrap.onpointerdown = (e: PointerEvent) => {
      isWheelDragging = true;
      wrap.setPointerCapture(e.pointerId);
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const [wLo, wHi] = S.expert || S.fullElasticity ? [-180, 180] : [-75, 75];
      let angle = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * (180 / Math.PI);
      S.wrist = clamp(Math.round(angle), wLo, wHi);
      updateWheelPointer(S.wrist);
      draw();
    };

    wrap.onpointermove = (e: PointerEvent) => {
      if (!isWheelDragging) return;
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const [wLo, wHi] = S.expert || S.fullElasticity ? [-180, 180] : [-75, 75];
      let angle = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * (180 / Math.PI);
      S.wrist = clamp(Math.round(angle), wLo, wHi);
      updateWheelPointer(S.wrist);
      draw();
    };

    wrap.onpointerup = wrap.onpointercancel = () => {
      if (isWheelDragging) {
        isWheelDragging = false;
        commit();
      }
    };

    const snapBtn = (lbl: string, deg: number) =>
      btn(lbl, () => {
        const [wLo, wHi] = S.expert || S.fullElasticity ? [-180, 180] : [-75, 75];
        S.wrist = clamp(deg, wLo, wHi);
        updateWheelPointer(S.wrist);
        commit();
        draw();
        toast(`Wrist: ${S.wrist}\xB0`, 1200);
      });

    const snaps = el(
      'div',
      { class: 'posing-wheel-snaps' },
      snapBtn('0\xB0 Flat', 0),
      snapBtn('75\xB0 Limit', 75),
      snapBtn('-75\xB0 Limit', -75),
      snapBtn('180\xB0 Back', 180)
    );

    const wristFineSlider = slider(
      'Fine-tune',
      '\xB0',
      () => (S.expert || S.fullElasticity ? [-180, 180] : [-75, 75]),
      () => S.wrist,
      (v) => {
        S.wrist = v;
        updateWheelPointer(S.wrist);
      }
    );

    const controls = el('div', { class: 'posing-wheel-controls' }, snaps, wristFineSlider);
    const body = el('div', { class: 'posing-wheel-body' }, wrap, controls);

    card.append(header, body);

    sync.push(() => {
      updateWheelPointer(S.wrist);
    });

    return card;
  }

  sync.push(updateTopHeaderAndToggles);

  const wheelWidget = createPosingWheel();

  fly(
    'ctrls',
    'r',
    'Precise Pose Controls',
    section(
      'Wrist Posing Wheel & Master Splay',
      '(O)',
      true,
      wheelWidget,
      slider('Master hand splay', '%', () => [-100, 100], () => S.splay, (v) => (S.splay = v))
    ),
    section('Digit Rotation Toggles & Cards', '[#]', true, menuHeader, cardsGrid),
    section('Canonical Rules & Reach', '{}', false, el('div', { id: 'rd', html: '<b>Gotz.Puppyt Hand Rig v2 \u2014 canonical rules &amp; reach.</b><br><b>Reach:</b> Middle 8 raw / 7 functional \xB7 Ring 7.5 / 6.5 \xB7 Index 7.5 / 6.5 \xB7 Pinky 7 / 6 \xB7 Thumb 5 / 4.5.<br><b>Proportions:</b> the middle finger sets the master 4:2:1:1 (metacarpal : proximal : middle : distal); each bone fits a 1-wide box, the distal leaves 12.5% empty each side (0.75 pyxl). 1 pyxl = 100 px.<br><b>Framerate Modes:</b> Brad 8 FPS \xB7 Lotte 12 FPS (Default) \xB7 Anime 15 FPS \xB7 Walt 24 FPS \xB7 Pure 60 FPS.' }))
  );

  updateFingerTabs();

  // Auto-minimize for TOP consolidated header (expands when hovered in top 1/5 of screen, unless over side menus)
  const headerEl = $<HTMLElement>('header');
  let isTopHovered = false;

  const updateAutoMinimize = (e: MouseEvent) => {
    // Top 1/5 of screen threshold = 20% of window.innerHeight
    const topThreshold = window.innerHeight * 0.20;
    const inTop20 = e.clientY <= topThreshold;

    // Check if cursor is hovering over a side console toolbar (.tb) or flyout drawer (.fly)
    const targetEl = e.target as HTMLElement | null;
    const isOverSideMenu = Boolean(targetEl && targetEl.closest && targetEl.closest('.tb, .fly'));

    if (headerEl) {
      // Do NOT activate top menu if hovering over side menus, toolbars, or drawers
      const expandTop = isTopHovered || (inTop20 && !isOverSideMenu);
      headerEl.classList.toggle('minimized', !expandTop);
    }
  };

  window.addEventListener('mousemove', updateAutoMinimize);

  if (headerEl) {
    headerEl.onmouseenter = () => { isTopHovered = true; headerEl.classList.remove('minimized'); };
    headerEl.onmouseleave = () => { isTopHovered = false; };
  }

  // ----------------------------------------------------
  // Bottom Pose Timeline with Easing Curve Dragging & Discrete Frame Steps
  // ----------------------------------------------------
  let tlTime = 0; // 0 to 1
  let tlAmplitude = 0; // 0 = straight line. Positive = ease out / in-out, Negative = ease in
  let tlFromPose = NEUTRAL;
  let tlMidPose = '(Blank)';
  let tlToPose = 'Fist';
  let tlPlaying = false;
  let tlLoop = true;
  let tlDuration = 1.5;
  let tlPlayRaf: number | null = null;
  let tlLastPlayTick = 0;

  function calcTimelineEasing(t: number, amplitude: number): number {
    if (Math.abs(amplitude) < 0.5) return t; // exact linear straight line
    const h = clamp(amplitude / 24, -1, 1);
    if (h > 0) {
      // Dragged UP: Ease-Out / Ease-In-Out
      const sCurve = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const easeOut = Math.sin((t * Math.PI) / 2);
      const curve = 0.6 * sCurve + 0.4 * easeOut;
      return (1 - h) * t + h * curve;
    } else {
      // Dragged DOWN: Ease-In / Accelerate
      const k = -h;
      const easeIn = 1 - Math.cos((t * Math.PI) / 2);
      return (1 - k) * t + k * easeIn;
    }
  }

  function getEasingName(amplitude: number): string {
    if (Math.abs(amplitude) < 0.8) return 'Linear (Straight)';
    if (amplitude > 14) return `Strong Ease-Out (+${Math.round((amplitude / 24) * 100)}%)`;
    if (amplitude > 2) return `Ease In-Out (+${Math.round((amplitude / 24) * 100)}%)`;
    if (amplitude < -14) return `Strong Ease-In (${Math.round((amplitude / 24) * 100)}%)`;
    return `Ease In (${Math.round((amplitude / 24) * 100)}%)`;
  }

  function applyTimelinePose(t: number) {
    // Total discrete frame slots connected to active performance mode FPS
    const totalFrames = Math.max(1, Math.round(tlDuration * currentFps));
    const currentFrame = Math.round(t * totalFrames);
    const snappedT = currentFrame / totalFrames;

    const from = poseState(tlFromPose);
    const to = poseState(tlToPose);
    const easedT = calcTimelineEasing(snappedT, tlAmplitude);

    if (tlMidPose && tlMidPose !== '(Blank)' && tlMidPose !== '') {
      const mid = poseState(tlMidPose);
      if (easedT <= 0.5) {
        const localT = easedT * 2;
        S = interpolatePose(from, mid, localT);
      } else {
        const localT = (easedT - 0.5) * 2;
        S = interpolatePose(mid, to, localT);
      }
    } else {
      S = interpolatePose(from, to, easedT);
    }
    draw();
  }

  let lastTicksSig = '';

  function renderTimeline() {
    const track = $<HTMLDivElement>('#tl-track');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const width = Math.max(100, rect.width || 300);
    const x0 = 14;
    const x1 = width - 14;
    const y0 = 24;

    const guide = $<SVGLineElement>('#tl-guide');
    const ticksGroup = $<SVGGElement>('#tl-frame-ticks');
    const line = $<SVGPathElement>('#tl-line');
    const nodeStart = $<SVGCircleElement>('#tl-node-start');
    const nodeMid = $<SVGCircleElement>('#tl-node-mid');
    const nodeEnd = $<SVGCircleElement>('#tl-node-end');
    const headGroup = $<SVGGElement>('#tl-head-group');
    const easeBadge = $<HTMLElement>('#tl-ease-badge');
    const timeEl = $<HTMLElement>('#tl-time');

    if (guide) {
      guide.setAttribute('x1', String(x0));
      guide.setAttribute('x2', String(x1));
      guide.setAttribute('y1', String(y0));
      guide.setAttribute('y2', String(y0));
    }

    const isStraight = Math.abs(tlAmplitude) < 0.5;
    const cpX = (x0 + x1) / 2;
    const cpY = y0 - tlAmplitude;
    let d = '';
    if (isStraight) {
      d = `M ${x0} ${y0} L ${x1} ${y0}`;
    } else {
      d = `M ${x0} ${y0} Q ${cpX} ${cpY} ${x1} ${y0}`;
    }
    if (line) {
      line.setAttribute('d', d);
      line.classList.toggle('bending', !isStraight);
    }

    // Mid node position at 50% along quadratic curve
    const midX = cpX;
    const midY = isStraight ? y0 : 0.25 * y0 + 0.5 * cpY + 0.25 * y0;

    if (nodeStart) {
      nodeStart.setAttribute('cx', String(x0));
      nodeStart.setAttribute('cy', String(y0));
    }
    if (nodeMid) {
      nodeMid.setAttribute('cx', String(midX));
      nodeMid.setAttribute('cy', String(midY));
      nodeMid.classList.toggle('active', Boolean(tlMidPose && tlMidPose !== '(Blank)'));
    }
    if (nodeEnd) {
      nodeEnd.setAttribute('cx', String(x1));
      nodeEnd.setAttribute('cy', String(y0));
    }

    const totalFrames = Math.max(1, Math.round(tlDuration * currentFps));
    const currentFrame = Math.round(tlTime * totalFrames);
    const snappedT = currentFrame / totalFrames;

    // Cache tick marks rendering to avoid DOM thrashing on every RAF frame
    const ticksSig = `${width}|${totalFrames}|${isStraight}|${cpY}|${y0}|${x0}|${x1}`;
    if (ticksGroup && ticksSig !== lastTicksSig) {
      lastTicksSig = ticksSig;
      let ticksHtml = '';
      for (let i = 0; i <= totalFrames; i++) {
        const ft = i / totalFrames;
        const fx = x0 + (x1 - x0) * ft;
        const fy = isStraight
          ? y0
          : (1 - ft) * (1 - ft) * y0 + 2 * (1 - ft) * ft * cpY + ft * ft * y0;
        const isKey = i === 0 || i === Math.round(totalFrames / 2) || i === totalFrames;
        if (!isKey) {
          ticksHtml += `<circle cx="${fx}" cy="${fy}" r="1.5" fill="var(--mut)" opacity="0.65"/>`;
        }
      }
      ticksGroup.innerHTML = ticksHtml;
    }

    // Position playhead smoothly on the line
    const curX = x0 + (x1 - x0) * snappedT;
    const curY = isStraight
      ? y0
      : (1 - snappedT) * (1 - snappedT) * y0 + 2 * (1 - snappedT) * snappedT * cpY + snappedT * snappedT * y0;
    if (headGroup) {
      headGroup.setAttribute('transform', `translate(${curX - 14}, ${curY - y0})`);
    }

    if (easeBadge) {
      easeBadge.textContent = getEasingName(tlAmplitude);
    }

    if (timeEl) {
      timeEl.textContent = `F${currentFrame}/${totalFrames} (${Math.round(snappedT * 100)}%) · ${(snappedT * tlDuration).toFixed(2)}s · ${currentFps} FPS`;
    }
  }

  function startTimeline() {
    tlPlaying = true;
    const playBtn = $<HTMLButtonElement>('#tl-play');
    if (playBtn) playBtn.textContent = '||';
    if (tlTime >= 1) tlTime = 0;
    let lastTime = performance.now();
    tlLastPlayTick = performance.now();

    const renderLoop = (now: number) => {
      if (!tlPlaying) return;
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      tlTime += delta / tlDuration;
      if (tlTime >= 1) {
        if (tlLoop) {
          tlTime = tlTime % 1;
        } else {
          tlTime = 1;
          stopTimeline();
          renderTimeline();
          applyTimelinePose(1);
          return;
        }
      }

      if (currentFps >= 60) {
        applyTimelinePose(tlTime);
      } else if (now - tlLastPlayTick >= frameInterval) {
        tlLastPlayTick = now - ((now - tlLastPlayTick) % frameInterval);
        applyTimelinePose(tlTime);
      } else {
        // Continuous smooth 60fps playhead UI render
        renderTimeline();
      }

      tlPlayRaf = requestAnimationFrame(renderLoop);
    };

    tlPlayRaf = requestAnimationFrame(renderLoop);
  }

  function stopTimeline() {
    tlPlaying = false;
    if (tlPlayRaf) {
      cancelAnimationFrame(tlPlayRaf);
      tlPlayRaf = null;
    }
    const playBtn = $<HTMLButtonElement>('#tl-play');
    if (playBtn) playBtn.textContent = '|>';
  }

  const tlPlayBtn = $<HTMLButtonElement>('#tl-play');
  if (tlPlayBtn) {
    tlPlayBtn.onclick = () => {
      if (tlPlaying) stopTimeline();
      else startTimeline();
    };
  }

  const tlLoopBtn = $<HTMLButtonElement>('#tl-loop');
  if (tlLoopBtn) {
    tlLoopBtn.onclick = () => {
      tlLoop = !tlLoop;
      tlLoopBtn.classList.toggle('on', tlLoop);
      toast(tlLoop ? 'Loop on' : 'Loop off', 1200);
    };
  }

  const tlOnionBtn = $<HTMLButtonElement>('#tl-onion');
  if (tlOnionBtn) {
    tlOnionBtn.onclick = () => {
      onionSkin = !onionSkin;
      tlOnionBtn.classList.toggle('on', onionSkin);
      markOnionSkinDirty();
      draw();
      toast(onionSkin ? 'Onion skin: ON' : 'Onion skin: OFF', 1200);
    };
  }

  const tlOnionDepthBtn = $<HTMLButtonElement>('#tl-onion-depth');
  if (tlOnionDepthBtn) {
    tlOnionDepthBtn.onclick = () => {
      onionDepth = (onionDepth % 4) + 1;
      tlOnionDepthBtn.textContent = `[N: ${onionDepth}]`;
      markOnionSkinDirty();
      if (onionSkin) draw();
      toast(`Onion skin depth: ${onionDepth} history poses`, 1400);
    };
  }

  if (tlFromSelect) {
    tlFromSelect.onchange = () => {
      tlFromPose = tlFromSelect.value;
      markOnionSkinDirty();
      applyTimelinePose(tlTime);
      if (onionSkin) draw();
    };
  }

  if (tlMidSelect) {
    tlMidSelect.onchange = () => {
      tlMidPose = tlMidSelect.value;
      markOnionSkinDirty();
      applyTimelinePose(tlTime);
      if (onionSkin) draw();
      renderTimeline();
    };
  }

  if (tlToSelect) {
    tlToSelect.onchange = () => {
      tlToPose = tlToSelect.value;
      markOnionSkinDirty();
      applyTimelinePose(tlTime);
      if (onionSkin) draw();
    };
  }

  const tlSwapBtn = $<HTMLButtonElement>('#tl-swap');
  if (tlSwapBtn) {
    tlSwapBtn.onclick = () => {
      const tmp = tlFromPose;
      tlFromPose = tlToPose;
      tlToPose = tmp;
      if (tlFromSelect) tlFromSelect.value = tlFromPose;
      if (tlToSelect) tlToSelect.value = tlToPose;
      markOnionSkinDirty();
      applyTimelinePose(tlTime);
      if (onionSkin) draw();
      toast('Swapped Start & End poses', 1200);
    };
  }

  const tlSetStartBtn = $<HTMLButtonElement>('#tl-set-start');
  if (tlSetStartBtn) {
    tlSetStartBtn.onclick = () => {
      const n = 'Start Pose';
      saved[n] = cleanPose(S);
      persist();
      refresh();
      tlFromPose = n;
      if (tlFromSelect) tlFromSelect.value = n;
      markOnionSkinDirty();
      applyTimelinePose(tlTime);
      if (onionSkin) draw();
      toast('Pinned current canvas pose as Start', 1500);
    };
  }

  const tlSetMidBtn = $<HTMLButtonElement>('#tl-set-mid');
  if (tlSetMidBtn) {
    tlSetMidBtn.onclick = () => {
      const n = 'Mid Pose';
      saved[n] = cleanPose(S);
      persist();
      refresh();
      tlMidPose = n;
      if (tlMidSelect) tlMidSelect.value = n;
      markOnionSkinDirty();
      applyTimelinePose(tlTime);
      if (onionSkin) draw();
      toast('Pinned current canvas pose as Mid (50%)', 1500);
    };
  }

  const tlSetEndBtn = $<HTMLButtonElement>('#tl-set-end');
  if (tlSetEndBtn) {
    tlSetEndBtn.onclick = () => {
      const n = 'End Pose';
      saved[n] = cleanPose(S);
      persist();
      refresh();
      tlToPose = n;
      if (tlToSelect) tlToSelect.value = n;
      markOnionSkinDirty();
      applyTimelinePose(tlTime);
      if (onionSkin) draw();
      toast('Pinned current canvas pose as End', 1500);
    };
  }

  const tlSaveQuickBtn = $<HTMLButtonElement>('#tl-save-quick');
  if (tlSaveQuickBtn) {
    tlSaveQuickBtn.onclick = () => savePose(true);
  }

  const easeBadge = $<HTMLElement>('#tl-ease-badge');
  if (easeBadge) {
    easeBadge.onclick = () => {
      tlAmplitude = 0;
      renderTimeline();
      applyTimelinePose(tlTime);
      toast('Reset easing to straight line (Linear)', 1500);
    };
  }

  // Interactive timeline track dragging
  let tlDragging = false;
  let tlDragStartY = 0;
  let tlDragStartAmp = 0;
  let tlLastScrubTime = 0;
  const trackEl = $<HTMLDivElement>('#tl-track');
  const tipEl = $<HTMLDivElement>('#tl-tip');

  if (trackEl) {
    trackEl.onpointerdown = (e: PointerEvent) => {
      tlDragging = true;
      trackEl.setPointerCapture(e.pointerId);
      tlDragStartY = e.clientY;
      tlDragStartAmp = tlAmplitude;
      if (tlPlaying) stopTimeline();

      const rect = trackEl.getBoundingClientRect();
      const x0 = 14;
      const x1 = rect.width - 14;
      const t = clamp((e.clientX - rect.left - x0) / (x1 - x0), 0, 1);
      tlTime = t;
      tlLastScrubTime = performance.now();

      renderTimeline();
      applyTimelinePose(t);

      if (tipEl) {
        tipEl.hidden = false;
        tipEl.style.left = `${Math.min(rect.width - 60, Math.max(60, e.clientX - rect.left))}px`;
        tipEl.textContent = `${Math.round(t * 100)}% · ${getEasingName(tlAmplitude)}`;
      }
    };

    trackEl.onpointermove = (e: PointerEvent) => {
      if (!tlDragging) return;
      const now = performance.now();
      const rect = trackEl.getBoundingClientRect();
      const x0 = 14;
      const x1 = rect.width - 14;
      const t = clamp((e.clientX - rect.left - x0) / (x1 - x0), 0, 1);
      tlTime = t;

      // Vertical movement adjusts curve easing (drag UP = arch, drag DOWN = dip)
      const deltaY = tlDragStartY - e.clientY;
      tlAmplitude = clamp(tlDragStartAmp + deltaY * 0.4, -24, 24);

      renderTimeline();

      // Throttled pose update during scrubbing matching the active framerate
      if (currentFps >= 60 || now - tlLastScrubTime >= frameInterval) {
        tlLastScrubTime = now;
        applyTimelinePose(t);
      }

      if (tipEl) {
        tipEl.style.left = `${Math.min(rect.width - 60, Math.max(60, e.clientX - rect.left))}px`;
        tipEl.textContent = `${Math.round(t * 100)}% · ${getEasingName(tlAmplitude)}`;
      }
    };

    trackEl.onpointerup = trackEl.onpointercancel = () => {
      if (!tlDragging) return;
      tlDragging = false;
      if (tipEl) tipEl.hidden = true;
      applyTimelinePose(tlTime);
      commit();
    };

    trackEl.ondblclick = () => {
      tlAmplitude = 0;
      renderTimeline();
      applyTimelinePose(tlTime);
      toast('Reset to straight line (Linear)', 1500);
    };
  }

  // Node clicks for quick snap to start or end
  const nodeStart = $<SVGCircleElement>('#tl-node-start');
  if (nodeStart) {
    nodeStart.onclick = (e) => {
      e.stopPropagation();
      tlTime = 0;
      renderTimeline();
      applyTimelinePose(0);
    };
  }
  const nodeMid = $<SVGCircleElement>('#tl-node-mid');
  if (nodeMid) {
    nodeMid.onclick = (e) => {
      e.stopPropagation();
      tlTime = 0.5;
      renderTimeline();
      applyTimelinePose(0.5);
    };
  }
  const nodeEnd = $<SVGCircleElement>('#tl-node-end');
  if (nodeEnd) {
    nodeEnd.onclick = (e) => {
      e.stopPropagation();
      tlTime = 1;
      renderTimeline();
      applyTimelinePose(1);
    };
  }

  refresh();
  updHist();
  draw();
  renderTimeline();

  // Return a cleanup function
  return () => {
    cancelAnimationFrame(anim);
    if (preview?.raf) cancelAnimationFrame(preview.raf);
    if (tlPlayRaf) cancelAnimationFrame(tlPlayRaf);
    if (dragTimer) clearTimeout(dragTimer);
    resizeObserver.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
