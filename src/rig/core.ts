export type Finger = 'index' | 'middle' | 'ring' | 'pinky' | 'thumb';
export type BuildType = 'standard' | 'claw' | 'trident' | 'mickey';

export interface HandState {
  expert: boolean;
  fullElasticity: boolean;
  splay: number;
  thumb: number;
  fs: {
    index: number;
    ring: number;
    pinky: number;
  };
  wrist: number;
  tilt: number;
  o: number; // knuckle overlap: 0.5 or 0
  wscale: boolean;
  boxes: boolean;
  skin: boolean;
  cj: {
    thumb: [number, number, number];
    index: [number, number, number];
    middle: [number, number, number];
    ring: [number, number, number];
    pinky: [number, number, number];
  };
  rot: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  };
  build: BuildType;
  ikPerFinger: Record<Finger, boolean>;
  wholeIk: boolean;
}

export const FINGER_ORDER: Finger[] = ['index', 'middle', 'ring', 'pinky', 'thumb'];
export const CONTROLS_FINGER_ORDER: Finger[] = ['index', 'ring', 'pinky', 'thumb', 'middle'];

export const BONES: Record<Finger, number[]> = {
  middle: [4, 2, 1, 1],
  ring: [3.75, 1.875, 0.9375, 0.9375],
  index: [3.75, 1.875, 0.9375, 0.9375],
  pinky: [3.5, 1.75, 0.875, 0.875],
  thumb: [2, 1, 1, 1],
};

export const SUM: Record<Finger, number> = {
  middle: 8,
  ring: 7.5,
  index: 7.5,
  pinky: 7,
  thumb: 5,
};

export const KN: Record<Finger, number> = {
  middle: 1,
  ring: 1,
  index: 1,
  pinky: 1,
  thumb: 0.5,
};

export const LIM: Record<Finger, number> = {
  thumb: -120,
  index: -30,
  middle: 0,
  ring: 30,
  pinky: 60,
};

export const BEND: Record<Finger, number> = {
  thumb: -1,
  index: 1,
  middle: 1,
  ring: 1,
  pinky: 1,
};

export const R = Math.PI / 180;

export const bendTurn = (d: Finger, cj: number) => -BEND[d] * cj;

export function norm(a: number): number {
  return ((a + 540) % 360) - 180;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function cRange(d: Finger, expert?: boolean): [number, number] {
  if (expert) return [-90, 90];
  return d === 'thumb' ? [-20, 80] : [-20, 90];
}

export function rRange(d: Finger, expert?: boolean, fullElasticity?: boolean): [number, number] {
  if (expert) {
    if (d === 'thumb') return [-90, 90];
    if (d === 'pinky') return [-24, 90];
    return [-90, 90];
  }
  if (fullElasticity) {
    if (d === 'thumb') return [-90, 90];
    if (d === 'pinky') return [-24, 90];
    return [-75, 75];
  }
  // Q2 baseline ±75° (150° total)
  if (d === 'thumb') return [-75, 75];
  if (d === 'pinky') return [-24, 28]; // inner -24° touches ring, outer +28°
  return [-75, 75];
}

export function applyMetacarpalProgressiveStep(
  d: Finger,
  currentRot: number,
  dl: number,
  expert?: boolean
): number {
  if (expert) return clamp(currentRot + dl, -90, 90);

  const [rLo, rHi] = rRange(d, expert, false);

  // Moving back toward neutral (0°) has low resistance
  const movingAway = (dl > 0 && currentRot > 0.2) || (dl < 0 && currentRot < -0.2);
  if (!movingAway) {
    return clamp(currentRot + dl * 0.5, rLo, rHi);
  }

  // Moving away: progressive resistance smoothly stiffening to functional stop
  const bound = currentRot >= 0 ? rHi : -rLo;
  const u = Math.min(1, Math.abs(currentRot) / Math.max(1, bound));
  const complianceFactor = d === 'thumb' ? 0.65 : d === 'pinky' ? 0.24 : 0.08;
  const progressiveCompliance = Math.pow(Math.max(0, 1 - u * u), 2) * complianceFactor;

  const nextRot = currentRot + dl * progressiveCompliance;
  return clamp(nextRot, rLo, rHi);
}

export function calcA(d: Finger, state: HandState): number {
  const extra = d === 'thumb' ? state.thumb : d === 'middle' ? 0 : state.fs[d] ?? 0;
  const effectiveSplay = clamp(state.splay + extra, -100, 100);
  return (LIM[d] * effectiveSplay) / 100 + state.tilt + (state.rot[d] ?? 0);
}

export function wid(d: Finger, wscale = false): number {
  const baseW = 0.75;
  const scale = d === 'thumb' ? 0.9 : SUM[d] / SUM.middle;
  const standardW = baseW * scale;
  if (wscale && d !== 'thumb') {
    return standardW * ((SUM[d] - KN[d]) / 7);
  }
  return standardW;
}

export function getBoneBox(d: Finger, i: number) {
  const bones = BONES[d];
  const len = bones[i];
  const scale = d === 'thumb' ? 1 : SUM[d] / SUM.middle;
  const boxW = 1 * scale;
  const emptyMargin = 0.125 * boxW;
  return {
    boxW,
    boxH: len,
    emptyMargin,
  };
}

export function reach(d: Finger, o: number): number {
  const knOvl = o > 0 ? KN[d] : 0;
  return SUM[d] - knOvl;
}

export function defaultState(): HandState {
  return {
    expert: false,
    fullElasticity: false,
    splay: 30,
    thumb: 10,
    fs: {
      index: 0,
      ring: 0,
      pinky: 0,
    },
    wrist: 0,
    tilt: 0,
    o: 0.5,
    wscale: false,
    boxes: false,
    skin: true,
    cj: {
      thumb: [0, 0, 0],
      index: [0, 0, 0],
      middle: [0, 0, 0],
      ring: [0, 0, 0],
      pinky: [0, 0, 0],
    },
    rot: {
      thumb: 0,
      index: 0,
      middle: 0,
      ring: 0,
      pinky: 0,
    },
    build: 'standard',
    ikPerFinger: {
      thumb: true,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
    },
    wholeIk: false,
  };
}

export function cleanPose(raw: Partial<HandState> & Record<string, any>): Partial<HandState> {
  const res: any = {};
  if (raw.splay !== undefined) res.splay = clamp(Number(raw.splay) || 0, -100, 100);
  if (raw.thumb !== undefined) res.thumb = clamp(Number(raw.thumb) || 0, -100, 100);
  if (raw.wrist !== undefined) res.wrist = Number(raw.wrist) || 0;
  if (raw.tilt !== undefined) res.tilt = clamp(Number(raw.tilt) || 0, -30, 30);
  if (raw.o !== undefined) res.o = Number(raw.o) > 0 ? 0.5 : 0;
  if (raw.wscale !== undefined) res.wscale = Boolean(raw.wscale);
  if (raw.boxes !== undefined) res.boxes = Boolean(raw.boxes);
  if (raw.skin !== undefined) res.skin = Boolean(raw.skin);
  if (raw.expert !== undefined) res.expert = Boolean(raw.expert);
  if (raw.fullElasticity !== undefined) res.fullElasticity = Boolean(raw.fullElasticity);
  if (raw.build !== undefined) res.build = raw.build;
  if (raw.wholeIk !== undefined) res.wholeIk = Boolean(raw.wholeIk);
  if (raw.ikPerFinger) {
    res.ikPerFinger = {
      thumb: Boolean(raw.ikPerFinger.thumb ?? true),
      index: Boolean(raw.ikPerFinger.index ?? true),
      middle: Boolean(raw.ikPerFinger.middle ?? true),
      ring: Boolean(raw.ikPerFinger.ring ?? true),
      pinky: Boolean(raw.ikPerFinger.pinky ?? true),
    };
  }
  if (raw.fs) {
    res.fs = {
      index: clamp(Number(raw.fs.index) || 0, -100, 100),
      ring: clamp(Number(raw.fs.ring) || 0, -100, 100),
      pinky: clamp(Number(raw.fs.pinky) || 0, -100, 100),
    };
  }
  if (raw.rot) {
    res.rot = {
      thumb: Number(raw.rot.thumb) || 0,
      index: Number(raw.rot.index) || 0,
      middle: Number(raw.rot.middle) || 0,
      ring: Number(raw.rot.ring) || 0,
      pinky: Number(raw.rot.pinky) || 0,
    };
  }
  if (raw.cj) {
    res.cj = {
      thumb: [Number(raw.cj.thumb?.[0]) || 0, Number(raw.cj.thumb?.[1]) || 0, Number(raw.cj.thumb?.[2]) || 0],
      index: [Number(raw.cj.index?.[0]) || 0, Number(raw.cj.index?.[1]) || 0, Number(raw.cj.index?.[2]) || 0],
      middle: [Number(raw.cj.middle?.[0]) || 0, Number(raw.cj.middle?.[1]) || 0, Number(raw.cj.middle?.[2]) || 0],
      ring: [Number(raw.cj.ring?.[0]) || 0, Number(raw.cj.ring?.[1]) || 0, Number(raw.cj.ring?.[2]) || 0],
      pinky: [Number(raw.cj.pinky?.[0]) || 0, Number(raw.cj.pinky?.[1]) || 0, Number(raw.cj.pinky?.[2]) || 0],
    };
  }
  return res;
}

export function sanitizeHandState(input: any): HandState {
  const def = defaultState();
  if (!input || typeof input !== 'object') return def;

  const validNum = (v: any, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);

  const cleanFS = {
    index: clamp(validNum(input.fs?.index, def.fs.index), -100, 100),
    ring: clamp(validNum(input.fs?.ring, def.fs.ring), -100, 100),
    pinky: clamp(validNum(input.fs?.pinky, def.fs.pinky), -100, 100),
  };

  const cleanRot = { ...def.rot };
  for (const d of FINGER_ORDER) {
    cleanRot[d] = validNum(input.rot?.[d], def.rot[d]);
  }

  const cleanCJ = { ...def.cj };
  for (const d of FINGER_ORDER) {
    const rawArr = input.cj?.[d];
    cleanCJ[d] = [
      validNum(rawArr?.[0], def.cj[d][0]),
      validNum(rawArr?.[1], def.cj[d][1]),
      validNum(rawArr?.[2], def.cj[d][2]),
    ];
  }

  const cleanIkPerFinger: Record<Finger, boolean> = {
    thumb: input.ikPerFinger?.thumb !== undefined ? Boolean(input.ikPerFinger.thumb) : def.ikPerFinger.thumb,
    index: input.ikPerFinger?.index !== undefined ? Boolean(input.ikPerFinger.index) : def.ikPerFinger.index,
    middle: input.ikPerFinger?.middle !== undefined ? Boolean(input.ikPerFinger.middle) : def.ikPerFinger.middle,
    ring: input.ikPerFinger?.ring !== undefined ? Boolean(input.ikPerFinger.ring) : def.ikPerFinger.ring,
    pinky: input.ikPerFinger?.pinky !== undefined ? Boolean(input.ikPerFinger.pinky) : def.ikPerFinger.pinky,
  };

  const validBuilds: BuildType[] = ['standard', 'claw', 'trident', 'mickey'];
  const cleanBuild: BuildType = validBuilds.includes(input.build) ? input.build : def.build;

  const expert = Boolean(input.expert);
  const fullElasticity = Boolean(input.fullElasticity);

  const rawWrist = validNum(input.wrist, def.wrist);
  const cleanWrist = expert || fullElasticity ? norm(rawWrist) : clamp(rawWrist, -75, 75);

  const rawState: HandState = {
    expert,
    fullElasticity,
    splay: clamp(validNum(input.splay, def.splay), -100, 100),
    thumb: clamp(validNum(input.thumb, def.thumb), -100, 100),
    wrist: cleanWrist,
    tilt: clamp(validNum(input.tilt, def.tilt), -30, 30),
    o: input.o > 0 ? 0.5 : 0,
    wscale: Boolean(input.wscale),
    boxes: Boolean(input.boxes),
    skin: Boolean(input.skin ?? true),
    build: cleanBuild,
    fs: cleanFS,
    rot: cleanRot,
    cj: cleanCJ,
    ikPerFinger: cleanIkPerFinger,
    wholeIk: Boolean(input.wholeIk),
  };

  return clampStateToLimits(rawState);
}

export function clampStateToLimits(st: HandState): HandState {
  const expert = st.expert;
  const fullElasticity = st.fullElasticity;
  const splay = clamp(st.splay, -100, 100);
  const thumb = clamp(st.thumb, -100, 100);
  const wrist = expert || fullElasticity ? norm(st.wrist) : clamp(st.wrist, -75, 75);
  const tilt = clamp(st.tilt, -30, 30);
  const fs = {
    index: clamp(st.fs.index, -100, 100),
    ring: clamp(st.fs.ring, -100, 100),
    pinky: clamp(st.fs.pinky, -100, 100),
  };
  const rot = { ...st.rot };
  const cj = {
    thumb: [...st.cj.thumb] as [number, number, number],
    index: [...st.cj.index] as [number, number, number],
    middle: [...st.cj.middle] as [number, number, number],
    ring: [...st.cj.ring] as [number, number, number],
    pinky: [...st.cj.pinky] as [number, number, number],
  };
  for (const d of FINGER_ORDER) {
    const [rLo, rHi] = rRange(d, expert, fullElasticity);
    rot[d] = clamp(rot[d], rLo, rHi);
    const [cLo, cHi] = cRange(d, expert);
    cj[d] = [
      clamp(cj[d][0], cLo, cHi),
      clamp(cj[d][1], cLo, cHi),
      clamp(cj[d][2], cLo, cHi),
    ];
  }
  return {
    ...st,
    fullElasticity,
    splay,
    thumb,
    wrist,
    tilt,
    fs,
    rot,
    cj,
  };
}

export interface JointPosition {
  x: number;
  y: number;
  phi: number;
}

export function jointPos(d: Finger, st: HandState): JointPosition[] {
  const bones = BONES[d];
  const n = bones.length;
  const knOvl = st.o > 0 ? KN[d] : 0;
  let phi = st.wrist + calcA(d, st);
  let x = 0;
  let y = 0;
  const pos: JointPosition[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i === 1 ? -knOvl / 2 : 0;
    const J = i === 0 ? knOvl : 0;
    const dist = a + bones[i] - J / 2;
    x += dist * Math.sin(phi * R);
    y -= dist * Math.cos(phi * R);
    pos.push({ x, y, phi });
    phi += bendTurn(d, st.cj[d]?.[i] ?? 0);
  }
  const lastBone = bones[n - 1];
  const tipX = x + lastBone * Math.sin(phi * R);
  const tipY = y - lastBone * Math.cos(phi * R);
  pos.push({ x: tipX, y: tipY, phi });
  return pos;
}

export function runIk(d: Finger, k: number, tx: number, ty: number, st: HandState): HandState {
  if (!isFinite(tx) || !isFinite(ty)) return st;
  // LOCK Q3: When per-finger IK is toggled off, early return
  if (st.ikPerFinger && st.ikPerFinger[d] === false) return st;

  const nextSt: HandState = {
    ...st,
    rot: { ...st.rot },
    cj: {
      ...st.cj,
      [d]: [...st.cj[d]],
    },
  };
  const bones = BONES[d];
  const n = bones.length;
  const effIndex = Math.min(Math.max(0, k), n - 1);
  const [cLo, cHi] = cRange(d, nextSt.expert);
  const [rLo, rHi] = rRange(d, nextSt.expert, nextSt.fullElasticity);

  for (let iter = 0; iter < 14; iter++) {
    for (let j = effIndex - 1; j >= -1; j--) {
      const positions = jointPos(d, nextSt);
      const eff = positions[effIndex];
      const distToTarget = Math.hypot(eff.x - tx, eff.y - ty);
      if (distToTarget < 1e-4) break;

      let jx = 0;
      let jy = 0;
      if (j >= 0) {
        jx = positions[j].x;
        jy = positions[j].y;
      }
      const vEx = eff.x - jx;
      const vEy = eff.y - jy;
      const vTx = tx - jx;
      const vTy = ty - jy;
      const cross = vEx * vTy - vEy * vTx;
      const dot = vEx * vTx + vEy * vTy;
      if (Math.abs(dot) < 1e-6 && Math.abs(cross) < 1e-6) continue;
      const dl = Math.atan2(cross, dot) / R;
      if (!isFinite(dl)) continue;

      if (j === -1) {
        if (nextSt.fullElasticity || nextSt.expert) {
          nextSt.rot[d] = clamp(nextSt.rot[d] + dl, rLo, rHi);
        } else {
          nextSt.rot[d] = applyMetacarpalProgressiveStep(d, nextSt.rot[d], dl, nextSt.expert);
        }

        // LOCK Q3: Whole-hand IK mode accumulates compliance across other active fingers
        if (nextSt.wholeIk) {
          const active = getActiveFingers(nextSt.build);
          for (const other of active) {
            if (other === d) continue;
            const pull = dl * 0.35;
            if (nextSt.fullElasticity || nextSt.expert) {
              const [oLo, oHi] = rRange(other, nextSt.expert, nextSt.fullElasticity);
              nextSt.rot[other] = clamp(nextSt.rot[other] + pull, oLo, oHi);
            } else {
              nextSt.rot[other] = applyMetacarpalProgressiveStep(other, nextSt.rot[other], pull, nextSt.expert);
            }
          }
        }
      } else if (j >= 0 && j < 3) {
        nextSt.cj[d][j] = clamp(nextSt.cj[d][j] - BEND[d] * dl, cLo, cHi);
      }
    }
  }
  nextSt.rot[d] = Math.round(nextSt.rot[d]);
  nextSt.cj[d][0] = Math.round(nextSt.cj[d][0]);
  nextSt.cj[d][1] = Math.round(nextSt.cj[d][1]);
  nextSt.cj[d][2] = Math.round(nextSt.cj[d][2]);
  return clampStateToLimits(nextSt);
}

export function getActiveFingers(build: BuildType = 'standard'): Finger[] {
  switch (build) {
    case 'claw':
      return ['index', 'thumb'];
    case 'trident':
      return ['middle', 'ring', 'thumb'];
    case 'mickey':
      return ['index', 'middle', 'ring', 'thumb'];
    case 'standard':
    default:
      return ['index', 'middle', 'ring', 'pinky', 'thumb'];
  }
}

export const PRESET_POSES: Record<string, Partial<HandState>> = {
  'Flat': {
    splay: 30,
    thumb: 10,
    wrist: 0,
    tilt: 0,
    fs: { index: 0, ring: 0, pinky: 0 },
    rot: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
    cj: {
      thumb: [0, 0, 0],
      index: [0, 0, 0],
      middle: [0, 0, 0],
      ring: [0, 0, 0],
      pinky: [0, 0, 0],
    },
  },
  'Don': {
    splay: 30,
    thumb: 10,
    wrist: 75,
    tilt: 0,
    o: 0.5,
    wscale: false,
    boxes: false,
    skin: true,
    expert: false,
    fullElasticity: false,
    build: 'standard',
    wholeIk: false,
    ikPerFinger: {
      thumb: true,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
    },
    fs: {
      index: 0,
      ring: 0,
      pinky: 0,
    },
    rot: {
      thumb: 0,
      index: 2,
      middle: -1,
      ring: -10,
      pinky: -22,
    },
    cj: {
      thumb: [0, 0, 0],
      index: [78, -9, 74],
      middle: [76, 51, -11],
      ring: [90, 9, -4],
      pinky: [90, 1, -7],
    },
  },
};
