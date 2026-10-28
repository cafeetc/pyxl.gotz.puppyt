import {
  Finger,
  HandState,
  BONES,
  KN,
  SUM,
  R,
  bendTurn,
  calcA,
  wid,
  getBoneBox,
  getActiveFingers,
  FINGER_ORDER,
} from './core.ts';
import { ART, ART_ORDER, ArtPart } from './art.ts';

export function bendMark(turn: number, cj: number): string {
  const r = 0.3;
  const a = turn * R;
  const dir = Math.sign(turn);
  const f = (n: number) => n.toFixed(3);
  const px = r * Math.sin(a);
  const py = -r * Math.cos(a);
  const tx = dir * Math.cos(a);
  const ty = dir * Math.sin(a);
  const head: [number, number][] = [
    [px + tx * 0.1, py + ty * 0.1],
    [px - ty * 0.055, py + tx * 0.055],
    [px + ty * 0.055, py - tx * 0.055],
  ];
  return `<g class="bend ${cj < 0 ? 'ext' : 'flex'}"><path d="M 0 ${f(-r)} A ${r} ${r} 0 ${Math.abs(turn) > 180 ? 1 : 0} ${turn > 0 ? 1 : 0} ${f(px)} ${f(py)}"/><path class="head" d="M ${head.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L ')} Z"/></g>`;
}

export function boneSpan(d: Finger, i: number, o: number, skin = false) {
  const len = BONES[d][i];
  const ko = o > 0 ? KN[d] : 0;
  const a = i === 1 ? -ko / 2 : 0;
  const trim = d === 'thumb' && !skin ? 0 : ko / 2;
  const top = -(a + len);
  const bot = -a;
  return { top: i === 0 ? top + trim : top, bot: i === 1 ? bot - trim : bot };
}

export const ART_FOR: Record<Finger, ArtPart[]> = {
  thumb: ['proximal', 'middle', 'middle', 'distal'],
  index: ART_ORDER,
  middle: ART_ORDER,
  ring: ART_ORDER,
  pinky: ART_ORDER,
};

export function skinPath(part: ArtPart, yBase: number, len: number): string {
  const a = ART[part];
  const f = (v: number) => +v.toFixed(3);
  let d = `M ${f(a[0] * len)} ${f(yBase + a[1] * len)}`;
  for (let i = 2; i < a.length; i += 6) {
    d += ` C ${f(a[i] * len)} ${f(yBase + a[i + 1] * len)} ${f(a[i + 2] * len)} ${f(yBase + a[i + 3] * len)} ${f(a[i + 4] * len)} ${f(yBase + a[i + 5] * len)}`;
  }
  return d + ' Z';
}

export function makeOctagonPoints(r: number, cx = 0, cy = 0): string {
  const f = (n: number) => +n.toFixed(3);
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 + Math.PI / 8;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    pts.push(`${f(x)},${f(y)}`);
  }
  return pts.join(' ');
}

export function structuralBonePath(d: Finger, i: number, yTop: number, yBot: number, w: number, n: number): string {
  const f = (v: number) => +v.toFixed(3);
  const h = Math.abs(yBot - yTop);
  if (i === n - 1) {
    // Distal tip segment with rigid octagonal faceted dome arch
    const l = -w * 0.46;
    const r = w * 0.46;
    const lShaft = -w * 0.38;
    const rShaft = w * 0.38;
    const yMid = yTop + h * 0.5;
    const crownCapR = w * 0.32;
    const yDomeMid = yTop + h * 0.25;

    return (
      `M ${f(l)} ${f(yBot)} ` +
      `L ${f(l)} ${f(yBot - h * 0.2)} ` +
      `L ${f(lShaft)} ${f(yMid + h * 0.1)} ` +
      `L ${f(lShaft)} ${f(yMid)} ` +
      `L ${f(lShaft)} ${f(yDomeMid)} ` +
      `L ${f(-crownCapR)} ${f(yTop + h * 0.08)} ` +
      `L 0 ${f(yTop)} ` +
      `L ${f(crownCapR)} ${f(yTop + h * 0.08)} ` +
      `L ${f(rShaft)} ${f(yDomeMid)} ` +
      `L ${f(rShaft)} ${f(yMid)} ` +
      `L ${f(rShaft)} ${f(yMid + h * 0.1)} ` +
      `L ${f(r)} ${f(yBot - h * 0.2)} ` +
      `L ${f(r)} ${f(yBot)} Z`
    );
  } else {
    // Shaft bones (metacarpals, proximals, middle) with rigid octagonal condyle flares & waist chamfers
    const l = -w * 0.46;
    const r = w * 0.46;
    const lMid = -w * 0.37;
    const rMid = w * 0.37;
    const lTop = -w * 0.44;
    const rTop = w * 0.44;
    const yMid = yTop + h * 0.5;

    return (
      `M ${f(l)} ${f(yBot)} ` +
      `L ${f(l)} ${f(yBot - h * 0.2)} ` +
      `L ${f(lMid)} ${f(yMid + h * 0.1)} ` +
      `L ${f(lMid)} ${f(yMid)} ` +
      `L ${f(lMid)} ${f(yMid - h * 0.1)} ` +
      `L ${f(lTop)} ${f(yTop + h * 0.2)} ` +
      `L ${f(lTop)} ${f(yTop)} ` +
      `L ${f(rTop)} ${f(yTop)} ` +
      `L ${f(rTop)} ${f(yTop + h * 0.2)} ` +
      `L ${f(rMid)} ${f(yMid - h * 0.1)} ` +
      `L ${f(rMid)} ${f(yMid)} ` +
      `L ${f(rMid)} ${f(yMid + h * 0.1)} ` +
      `L ${f(r)} ${f(yBot - h * 0.2)} ` +
      `L ${f(r)} ${f(yBot)} Z`
    );
  }
}

export function handMarkup(st: HandState, hit = false, bend = false): string {
  const chain = (d: Finger, i: number): string => {
    const B = BONES[d];
    const n = B.length;
    const ko = st.o > 0 ? KN[d] : 0;
    const w = wid(d, st.wscale);
    const len = B[i];
    const a = i === 1 ? -ko / 2 : 0;
    const J = i === 0 ? ko : 0;
    const top = -(a + len);
    const bot = -a;
    const sr = (d === 'thumb' ? 0.125 : 0.22) * (SUM[d] / 8);
    const jr = i === 0 ? KN[d] / 2 : sr;
    const { boxW, emptyMargin } = getBoneBox(d, i);
    let s2 = '';
    if (st.boxes) {
      s2 += `<rect class="box" x="${-boxW / 2}" y="${top}" width="${boxW}" height="${len}" stroke-dasharray="0.06 0.06"/>`;
      if (i === n - 1) {
        for (const x of [-boxW / 2 + emptyMargin, boxW / 2 - emptyMargin]) {
          s2 += `<line class="box" x1="${x}" y1="${top}" x2="${x}" y2="${bot}" stroke-opacity="0.45" stroke-dasharray="0.03 0.03"/>`;
        }
      }
    }
    const art = st.skin && i < ART_FOR[d].length;
    if (i > 0 && !art) {
      const hw = w / 2;
      const ch = Math.min(0.04, Math.min(hw, sr) * 0.4);
      const f = (v: number) => +v.toFixed(3);
      const buffPts = [
        `${f(-hw + ch)},${f(-sr)}`,
        `${f(hw - ch)},${f(-sr)}`,
        `${f(hw)},${f(-sr + ch)}`,
        `${f(hw)},${f(sr - ch)}`,
        `${f(hw - ch)},${f(sr)}`,
        `${f(-hw + ch)},${f(sr)}`,
        `${f(-hw)},${f(sr - ch)}`,
        `${f(-hw)},${f(-sr + ch)}`,
      ].join(' ');
      s2 += `<polygon class="buff" points="${buffPts}"/>`;
    }
    const { top: yTop, bot: yBot } = boneSpan(d, i, st.o, st.skin);
    if (art) {
      s2 += `<path class="bone" d="${skinPath(ART_FOR[d][i], yBot, yBot - yTop)}"/>`;
    } else {
      s2 += `<path class="bone" d="${structuralBonePath(d, i, yTop, yBot, w, n)}"/>`;
    }
    if (hit) {
      const boneJointIdx = i;
      // Inset bone shaft hit box so it stays strictly centered between joint pins and never overlaps them
      const rectInset = 0.16;
      const rectY = yTop + rectInset;
      const rectH = Math.max(0.1, yBot - yTop - rectInset * 2);
      s2 += `<rect class="hit" x="${-w / 2 - 0.08}" y="${rectY}" width="${w + 0.16}" height="${rectH}" data-d="${d}" data-j="${boneJointIdx}" data-hit="bone"><title>${d} bone ${i}</title></rect>`;
      if (i === n - 1) {
        // Generous, centered fingertip hit target (child effector 3)
        s2 += `<circle class="hit" cx="0" cy="${top}" r="0.18" data-d="${d}" data-j="3" data-hit="tip"><title>${d} fingertip</title></circle>`;
      }
    }
    if (i + 1 < n) {
      const cj = st.cj[d][i] || 0;
      const turn = bendTurn(d, cj) || 0;
      s2 +=
        `<g transform="translate(0 ${top + J / 2})"><g transform="rotate(${turn})">${chain(d, i + 1)}<circle class="child-joint" r="0.065"/><circle class="parent-joint" r="0.035"/><circle class="joint-center" r="0.015" fill="var(--fg)" opacity="0.8"/>` +
        (hit ? `<circle class="hit" r="0.16" data-d="${d}" data-j="${i}" data-hit="joint"><title>${d} joint ${i}</title></circle>` : '') +
        `</g>` +
        (bend && cj ? bendMark(turn, cj) : '') +
        `</g>`;
    }
    return s2;
  };
  let s = st.boxes
    ? `<g class="box"><rect x="-2" y="-4" width="4" height="4"/><line x1="-1" y1="-4" x2="-1" y2="0"/><line x1="0" y1="-4" x2="0" y2="0"/><line x1="1" y1="-4" x2="1" y2="0"/></g>`
    : '';
  const active = getActiveFingers(st.build);

  // Render octagonal wrist socket and compact hit area in front
  const wristBase =
    `<g class="wrist-group">` +
    `<polygon class="wrist-sock" points="${makeOctagonPoints(0.32)}"/>` +
    `<polygon class="wrist-plug" points="${makeOctagonPoints(0.12)}"/>` +
    `<polygon class="wrist-ring" points="${makeOctagonPoints(0.18)}" fill="none" stroke="var(--acc)" stroke-width="0.015" opacity="0.6"/>` +
    `<circle class="parent-joint" r="0.04" fill="var(--acc)"/>` +
    (hit
      ? `<circle class="hit" cx="0" cy="0" r="0.2" data-w="1"><title>Wrist hub: drag to rotate the whole hand</title></circle>`
      : '') +
    `</g>`;

  for (const d of FINGER_ORDER) {
    if (active.includes(d)) {
      s += `<g data-d="${d}" transform="rotate(${calcA(d, st)})">${chain(d, 0)}</g>`;
    }
  }

  // Red wrist socket renders ON TOP in front of fingers in SVG z-order (compact so fingers win priority)
  return s + wristBase;
}
