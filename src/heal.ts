// Vector morphological compensation ("healing") for the mana-symbol foil coins. PURE, DOM-free.
//
// A mana symbol is its glyph knocked out of a circular foil field. Knocked-out (negative) detail is
// the robust polarity for foil — an unbonded sliver inside a bonded field peels away with the
// carrier sheet, whereas a tiny bonded island lifts — but the laser + foil still have a feature
// floor (MIN_FOIL, 0.4 mm): a knockout gap narrower than the floor won't resolve, and a foil web or
// island thinner than the floor won't bond/weed. So instead of falling back to a plain disc, the
// coin is HEALED: like font hinting for the laser, sub-floor negative detail is minimally
// thickened and sub-floor positive slivers are absorbed, so the real Scryfall art ships at any size.
//
// Pipeline per symbol (booleans + true morphological offsets via clipper-lib — Angus Johnson's
// Clipper, integer-robust and with native round-join polygon offsetting; polygon-clipping (Martinez)
// was tried first and rejected: it crashes with "Unable to find segment in SweepLine tree" on this
// workload's dense float boundaries, a known robustness failure of that implementation):
//   1. Flatten the glyph's path data (M/L/H/V/C/S/Q/T/A, absolute+relative) to polygons at ~0.02 mm
//      tolerance, in FINAL coin-local mm (healing is size-dependent, so it runs after scaling).
//   2. void₀   = glyph (subpath rings resolved even-odd) ∩ disc
//   3. thin    = void₀ − OPEN(void₀, r)          (the sub-floor parts of the knockout, r = floor/2)
//      voidH   = void₀ ∪ dilate(thin, r)         (thicken them to ≥ the floor instead of losing them)
//   4. F₀      = disc − voidH                    (the bonded foil region)
//      F       = OPEN(F₀, r)                     (absorb sub-floor foil islands and webs)
// The result F is the coin: every bonded feature ≥ the floor, every knockout gap ≥ the floor,
// asserted by heal.test.ts with a pathological synthetic glyph and the real W/U/B/R/G symbols.
//
// All Clipper work happens in integer micrometres (SCALE = 1000/mm); the public surface is plain
// float-mm rings: Ring = [x, y][], flat lists filled even-odd (Clipper emits holes with opposite
// orientation to their outers, so even-odd and nonzero agree on the result).

import ClipperLib from "clipper-lib";
import type { IntPath } from "clipper-lib";

export type Pair = [number, number];
export type Ring = Pair[];

// --- SVG path-data flattening ----------------------------------------------------------------

export type XY = [number, number];
export type Transform = (x: number, y: number) => XY;

const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g;

// Parse + flatten one path-data string into closed rings, applying `tf` (an affine map — it is
// applied to control points, which is exact for lines/beziers) BEFORE flattening so the tolerance
// is measured in target units. Arcs are transformed via their endpoint parameterisation (the only
// transforms used here are uniform-scale + y-flip, under which rx/ry scale and sweeps mirror).
export function flattenPathData(
  d: string,
  tol: number,
  tf: Transform = (x, y) => [x, y],
  scale = 1, // |uniform scale| of tf, for arc radii
  flipY = true, // tf mirrors y (symbol space is y-down, lid space is y-up)
): Ring[] {
  const tokens: (string | number)[] = [];
  for (const m of d.matchAll(CMD_RE)) tokens.push(m[1] ?? Number(m[2]));

  const rings: Ring[] = [];
  let ring: XY[] = [];
  let cmd = "";
  let i = 0;
  // Current point / subpath start in SOURCE coordinates; control points for S/T reflection.
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let pcx: number | null = null; // previous cubic control
  let pcy: number | null = null;
  let pqx: number | null = null; // previous quadratic control
  let pqy: number | null = null;

  const num = (): number => tokens[i++] as number;
  const emit = (x: number, y: number) => ring.push(tf(x, y));
  const closeRing = () => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };

  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    flattenCubic(ring, tf(cx, cy), tf(x1, y1), tf(x2, y2), tf(x, y), tol);
    pcx = x2;
    pcy = y2;
    pqx = pqy = null;
    cx = x;
    cy = y;
  };
  const quad = (x1: number, y1: number, x: number, y: number) => {
    // Elevate to cubic.
    const c1x = cx + (2 / 3) * (x1 - cx);
    const c1y = cy + (2 / 3) * (y1 - cy);
    const c2x = x + (2 / 3) * (x1 - x);
    const c2y = y + (2 / 3) * (y1 - y);
    flattenCubic(ring, tf(cx, cy), tf(c1x, c1y), tf(c2x, c2y), tf(x, y), tol);
    pqx = x1;
    pqy = y1;
    pcx = pcy = null;
    cx = x;
    cy = y;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === "string") {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        cx = sx;
        cy = sy;
        closeRing();
        continue;
      }
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "M") {
      const x = num();
      const y = num();
      closeRing(); // an unclosed previous subpath still counts as a ring
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      sx = cx;
      sy = cy;
      emit(cx, cy);
      cmd = rel ? "l" : "L"; // subsequent implicit pairs are lineto
      pcx = pcy = pqx = pqy = null;
    } else if (C === "L") {
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      emit(cx, cy);
      pcx = pcy = pqx = pqy = null;
    } else if (C === "H") {
      const x = num();
      cx = rel ? cx + x : x;
      emit(cx, cy);
      pcx = pcy = pqx = pqy = null;
    } else if (C === "V") {
      const y = num();
      cy = rel ? cy + y : y;
      emit(cx, cy);
      pcx = pcy = pqx = pqy = null;
    } else if (C === "C") {
      const x1 = num(),
        y1 = num(),
        x2 = num(),
        y2 = num(),
        x = num(),
        y = num();
      if (rel) cubic(cx + x1, cy + y1, cx + x2, cy + y2, cx + x, cy + y);
      else cubic(x1, y1, x2, y2, x, y);
    } else if (C === "S") {
      const x2 = num(),
        y2 = num(),
        x = num(),
        y = num();
      const rx1 = pcx != null && pcy != null ? 2 * cx - pcx : cx;
      const ry1 = pcx != null && pcy != null ? 2 * cy - pcy : cy;
      if (rel) cubic(rx1, ry1, cx + x2, cy + y2, cx + x, cy + y);
      else cubic(rx1, ry1, x2, y2, x, y);
    } else if (C === "Q") {
      const x1 = num(),
        y1 = num(),
        x = num(),
        y = num();
      if (rel) quad(cx + x1, cy + y1, cx + x, cy + y);
      else quad(x1, y1, x, y);
    } else if (C === "T") {
      const x = num(),
        y = num();
      const rx1 = pqx != null && pqy != null ? 2 * cx - pqx : cx;
      const ry1 = pqx != null && pqy != null ? 2 * cy - pqy : cy;
      if (rel) quad(rx1, ry1, cx + x, cy + y);
      else quad(rx1, ry1, x, y);
    } else if (C === "A") {
      const rx = num(),
        ry = num(),
        rot = num(),
        largeArc = num(),
        sweep = num(),
        x = num(),
        y = num();
      const ex = rel ? cx + x : x;
      const ey = rel ? cy + y : y;
      flattenArc(
        ring,
        tf,
        [cx, cy],
        rx * scale,
        ry * scale,
        rot,
        largeArc !== 0,
        flipY ? sweep === 0 : sweep !== 0,
        [ex, ey],
        tol,
        scale,
        flipY,
      );
      cx = ex;
      cy = ey;
      pcx = pcy = pqx = pqy = null;
    } else {
      i++; // unknown token — skip defensively
    }
  }
  closeRing();
  return rings;
}

// Adaptive cubic flattening in TARGET space: subdivide until the control points sit within `tol`
// of the chord. p0 is the current point (already emitted); emits interior + end points.
function flattenCubic(out: XY[], p0: XY, p1: XY, p2: XY, p3: XY, tol: number, depth = 0): void {
  if (depth > 18 || isFlat(p0, p1, p2, p3, tol)) {
    out.push(p3);
    return;
  }
  // De Casteljau split at t = 0.5.
  const m = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = m(p0, p1);
  const p12 = m(p1, p2);
  const p23 = m(p2, p3);
  const p012 = m(p01, p12);
  const p123 = m(p12, p23);
  const mid = m(p012, p123);
  flattenCubic(out, p0, p01, p012, mid, tol, depth + 1);
  flattenCubic(out, mid, p123, p23, p3, tol, depth + 1);
}

function isFlat(p0: XY, p1: XY, p2: XY, p3: XY, tol: number): boolean {
  // Max deviation of a cubic from its chord is bounded by 3/4 · max control-point distance.
  const d = (p: XY): number => distToSegment(p, p0, p3);
  return 0.75 * Math.max(d(p1), d(p2)) <= tol;
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t =
    len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

// SVG arc (endpoint parameterisation, spec F.6.5) sampled so the sagitta stays within tol.
// Radii/rotation are given in TARGET scale; endpoints in SOURCE coords (mapped through tf).
function flattenArc(
  out: XY[],
  tf: Transform,
  from: XY,
  rx: number,
  ry: number,
  rotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: XY,
  tol: number,
  scale: number,
  flipY: boolean,
): void {
  const [x1, y1] = tf(from[0], from[1]);
  const [x2, y2] = tf(to[0], to[1]);
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9) {
    out.push([x2, y2]);
    return;
  }
  const phi = ((flipY ? -rotDeg : rotDeg) * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  let l = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (l > 1) {
    const s = Math.sqrt(l);
    rx *= s;
    ry *= s;
    l = 1;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const det = ux * vy - uy * vx;
    return Math.atan2(det, dot);
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const rMax = Math.max(rx, ry);
  const step = Math.max(0.05, 2 * Math.acos(Math.max(0, Math.min(1, 1 - tol / rMax))));
  const n = Math.max(1, Math.ceil(Math.abs(dth) / step));
  for (let k = 1; k <= n; k++) {
    const th = th1 + (dth * k) / n;
    const px = cx + rx * Math.cos(th) * cosP - ry * Math.sin(th) * sinP;
    const py = cy + rx * Math.cos(th) * sinP + ry * Math.sin(th) * cosP;
    out.push(k === n ? [x2, y2] : [px, py]);
  }
  void scale;
}

// --- polygon morphology (Clipper, integer µm) ----------------------------------------------------

const SCALE = 1000; // integer units per mm (1 µm)
const ARC_TOL = 0.005 * SCALE; // round-join facet tolerance for offsets

function toInt(rings: Ring[]): IntPath[] {
  return rings.map((r) =>
    r.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })),
  );
}

function fromInt(paths: IntPath[]): Ring[] {
  return paths.map((p) => p.map((pt): Pair => [pt.X / SCALE, pt.Y / SCALE]));
}

const { ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;

function boolOp(clipType: number, subject: IntPath[], clip: IntPath[]): IntPath[] {
  if (subject.length === 0) return clipType === ClipType.ctUnion ? clip.slice() : [];
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, PolyType.ptSubject, true);
  if (clip.length > 0) c.AddPaths(clip, PolyType.ptClip, true);
  const solution: IntPath[] = [];
  c.Execute(clipType, solution, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return solution;
}

const unionI = (a: IntPath[], b: IntPath[]) => boolOp(ClipType.ctUnion, a, b);
const differenceI = (a: IntPath[], b: IntPath[]) => boolOp(ClipType.ctDifference, a, b);
const intersectionI = (a: IntPath[], b: IntPath[]) => boolOp(ClipType.ctIntersection, a, b);

// True morphological offset: positive delta dilates, negative erodes (round joins).
function offsetI(paths: IntPath[], deltaMm: number): IntPath[] {
  if (paths.length === 0) return [];
  const co = new ClipperLib.ClipperOffset(2, ARC_TOL);
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon);
  const solution: IntPath[] = [];
  co.Execute(solution, deltaMm * SCALE);
  return solution;
}

// OPEN keeps only the parts that can host a disc of radius r (erode, then grow back).
const openI = (paths: IntPath[], r: number) => offsetI(offsetI(paths, -r), r);

function areaI(paths: IntPath[]): number {
  let a = 0;
  for (const p of paths) a += ClipperLib.Clipper.Area(p); // holes carry opposite sign
  return Math.abs(a) / (SCALE * SCALE);
}

function circleRing(cx: number, cy: number, r: number, segs = 72): Ring {
  const rr = r / Math.cos(Math.PI / segs); // circumscribe: the polygon fully covers the disc
  const ring: Ring = [];
  for (let i = 0; i < segs; i++) {
    const th = (2 * Math.PI * i) / segs;
    ring.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th)]);
  }
  return ring;
}

// Morphological offset of closed rings (positive delta dilates, negative erodes; round joins),
// public for the lid frame's glue-trace band (lidart.ts): the window silhouette inset by the band
// width gives a true parallel inner boundary whatever the ornament curvature. Orientation is
// normalised per ring, so callers can pass either winding; expects flat OUTER rings (no holes).
export function offsetRings(rings: Ring[], deltaMm: number): Ring[] {
  const oriented = rings.map((r) => (ringsArea([r]) < 0 ? [...r].reverse() : r));
  return fromInt(offsetI(toInt(oriented), deltaMm));
}

// Total signed area of a flat ring list (mm²) — public so tests can sanity-check winding.
export function ringsArea(rings: Ring[]): number {
  let total = 0;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]!;
      const [x2, y2] = ring[(i + 1) % ring.length]!;
      a += x1 * y2 - x2 * y1;
    }
    total += a / 2;
  }
  return total;
}

// --- the coin ------------------------------------------------------------------------------------

export type HealedCoin = {
  foil: Ring[]; // the bonded coin region, coin-local mm (y up, centred on 0,0), even-odd rings
  glyph: Ring[]; // the raw (unhealed) glyph clipped to the disc — the multi-mode engrave art
  stats: {
    glyphThickenedArea: number; // mm² of sub-floor knockout detail that was widened
    foilAbsorbedArea: number; // mm² of sub-floor foil webs/islands absorbed into the knockout
  };
};

export const FLATTEN_TOL = 0.02; // mm

// Scryfall symbol glyphs live in a 0..100 y-down viewBox; map to coin-local mm, y up, centred.
function symbolTransform(sizeMm: number): { tf: Transform; scale: number } {
  const s = sizeMm / 100;
  return { tf: (x, y) => [(x - 50) * s, (50 - y) * s], scale: s };
}

// Glyph path data -> even-odd region (subpath rings resolved), clipped to a disc of radius clipR.
function glyphRegion(glyphD: string, sizeMm: number, clipR: number): IntPath[] {
  const { tf, scale } = symbolTransform(sizeMm);
  const rings = flattenPathData(glyphD, FLATTEN_TOL, tf, scale, true);
  if (rings.length === 0) return [];
  const region = ClipperLib.Clipper.SimplifyPolygons(toInt(rings), PolyFillType.pftEvenOdd);
  return intersectionI(region, toInt([circleRing(0, 0, clipR)]));
}

// Build the healed coin for one symbol at one size. Deterministic; callers may cache by
// (symbol, size) — see lidart.ts.
export function healCoin(glyphD: string, sizeMm: number, floorMm: number): HealedCoin {
  const discR = sizeMm / 2;
  const disc = toInt([circleRing(0, 0, discR)]);
  const r = floorMm / 2;

  const void0 = glyphRegion(glyphD, sizeMm, discR - 0.1); // keep a hair of rim so the coin edge stays clean
  if (void0.length === 0) {
    return {
      foil: fromInt(disc),
      glyph: [],
      stats: { glyphThickenedArea: 0, foilAbsorbedArea: 0 },
    };
  }

  // Thicken sub-floor knockout detail to the floor instead of losing it.
  const openVoid = openI(void0, r);
  const thin = differenceI(void0, openVoid);
  const voidHealed = thin.length > 0 ? unionI(void0, offsetI(thin, r)) : void0;
  const glyphThickenedArea = Math.max(0, areaI(voidHealed) - areaI(void0));

  // The bonded foil, with sub-floor webs/islands absorbed into the knockout.
  const f0 = differenceI(disc, voidHealed);
  const foil = openI(f0, r);
  const foilAbsorbedArea = Math.max(0, areaI(f0) - areaI(foil));

  return {
    foil: fromInt(foil),
    glyph: fromInt(void0),
    stats: { glyphThickenedArea, foilAbsorbedArea },
  };
}
