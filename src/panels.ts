// Panel geometry for the laser-cut MTG deck box: ten flat, kerf-compensated, finger-jointed panel
// outlines derived purely from Params/dims (see src/params.ts). No DOM, no SVG, no three.js — pure
// 2D polygon math shared by the SVG export and the 3D preview.
//
// ---------------------------------------------------------------------------------------------
// JOINERY SCHEME
// ---------------------------------------------------------------------------------------------
// World frame: the body box occupies [0,outerW]×[0,outerD]×[0,bodyH], Z up. The cap is placed in
// its ASSEMBLED (closed) position: it overhangs the body by thickness+capFit on every side and its
// top face ends at assembledH. t = sheet thickness throughout.
//
// Blanks: every wall spans the FULL outer extent of its face (wide walls outerW wide, narrow walls
// outerD wide, all bodyH tall) — the vertical corner columns (t × t × height) are shared by the
// two meeting walls and alternate between them along the corner comb. Wide walls (±Y faces) own
// the comb's A-phase (material first: segments 0, 2, …), narrow walls (±X faces) the B-phase.
// Since the comb count is odd, each wall's vertical edge starts and ends with its own element.
//
// The floor spans the cavity (innerW × innerD) plus tabs that pass fully through the walls and
// finish flush with the outer faces, so its bounding box is the whole footprint. Along each wall's
// bottom edge, tabs sit at the B-phase intervals of a comb over the INNER span only (never in the
// corner columns), and the wall carries matching edge notches, t deep. The cap is the same box
// upside town: cap-top tabs into notches at the cap walls' TOP edges; the cap walls' bottom rim
// (the open mouth) is plain.
//
// Kerf: see combBreakpoints — every internal finger/slot boundary shifts k/2 toward the slot, so
// material elements grow into their mating panel's shrunken openings while every panel's outer
// envelope stays exactly nominal.
//
// place: local outline points (u, v) extrude to (u, v, w), w ∈ [0, t]; then world =
// Rz(rot[2])·Ry(rot[1])·Rx(rot[0]) applied to the local point, plus pos. Consumers should not
// re-derive this: use applyPlace() (or placeMatrix() for a three.js Matrix4.fromArray).

import { dims, effectiveNotchDepth, type Params } from "./params.ts";

export type Pt = [number, number];

export type Place = { pos: [number, number, number]; rot: [number, number, number] };

export type Panel = {
  id: string;
  outline: Pt[]; // closed CCW polygon, panel-local mm, origin at the bbox min corner; first point not repeated
  holes: Pt[][]; // interior cutouts (CW wound)
  size: [number, number]; // outline bounding box, = the blank's nominal envelope
  place: Place;
};

// --- finger-count policy -------------------------------------------------------------------
//
// Largest odd n (>= 3) such that each segment (edgeLen / n) is still >= 0.6 * fingerWidth. Odd n
// means a comb starts and ends with the same element, so each panel edge is symmetric.
export function fingerCount(edgeLen: number, fingerWidth: number): number {
  const minSeg = fingerWidth * 0.6;
  let n = Math.floor(edgeLen / minSeg);
  if (n % 2 === 0) n -= 1;
  if (n < 3) n = 3;
  return n;
}

// Segment i is an "A" element (the material/finger/tab side) iff its parity matches firstIsA.
export function isFinger(i: number, firstIsA: boolean): boolean {
  return (i % 2 === 0) === firstIsA;
}

// --- kerf-adjusted comb breakpoints ---------------------------------------------------------
//
// n+1 breakpoints along [0, length], nominal at i·length/n. With kerf k, every INTERNAL breakpoint
// shifts k/2 toward the slot side of that boundary (fingers grow, slots shrink); the two outer
// breakpoints never move, so the panel's own envelope stays nominal. An interior finger therefore
// grows by a full k, an end finger by k/2 — mirroring how the laser eats k/2 from each cut face.
export function combBreakpoints(
  length: number,
  n: number,
  firstIsA: boolean,
  kerf: number,
): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) pts.push((length * i) / n);
  for (let i = 1; i < n; i++) {
    const prevIsFinger = isFinger(i - 1, firstIsA);
    pts[i]! += prevIsFinger ? kerf / 2 : -kerf / 2;
  }
  return pts;
}

export type Interval = { a: number; b: number; finger: boolean };

// The comb as labeled intervals — the unit the tests reason about.
export function combIntervals(
  length: number,
  n: number,
  firstIsA: boolean,
  kerf: number,
): Interval[] {
  const bp = combBreakpoints(length, n, firstIsA, kerf);
  const out: Interval[] = [];
  for (let i = 0; i < n; i++) out.push({ a: bp[i]!, b: bp[i + 1]!, finger: isFinger(i, firstIsA) });
  return out;
}

// --- rotation/placement --------------------------------------------------------------------

// world = Rz(rz)·Ry(ry)·Rx(rx) · local + pos (x-rotation applied first).
export function applyPlace(pt: [number, number, number], place: Place): [number, number, number] {
  const [rx, ry, rz] = place.rot;
  let [x, y, z] = pt;
  // Rx
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  // Ry
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  // Rz
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + place.pos[0], y + place.pos[1], z + place.pos[2]];
}

// Column-major 4×4 of the same transform, ready for three.js Matrix4.fromArray().
export function placeMatrix(place: Place): number[] {
  const o = applyPlace([0, 0, 0], place);
  const ex = applyPlace([1, 0, 0], place);
  const ey = applyPlace([0, 1, 0], place);
  const ez = applyPlace([0, 0, 1], place);
  const d = (v: [number, number, number]) => [v[0] - o[0], v[1] - o[1], v[2] - o[2]];
  const [bx, by, bz] = [d(ex), d(ey), d(ez)];
  return [
    bx[0]!,
    bx[1]!,
    bx[2]!,
    0,
    by[0]!,
    by[1]!,
    by[2]!,
    0,
    bz[0]!,
    bz[1]!,
    bz[2]!,
    0,
    o[0],
    o[1],
    o[2],
    1,
  ];
}

// --- outline builders ----------------------------------------------------------------------

const DIP_SEGS = 16;

// A smooth dip (half-ellipse) cut into a panel's top edge, returned right-to-left (CCW top edge).
function dipPoints(uc: number, halfW: number, depth: number, topV: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= DIP_SEGS; i++) {
    const th = (Math.PI * i) / DIP_SEGS;
    pts.push([uc + halfW * Math.cos(th), topV - depth * Math.sin(th)]);
  }
  return pts;
}

type WallSpec = {
  W: number; // blank width (full outer extent of the face)
  H: number; // blank height
  t: number;
  kerf: number;
  fingerWidth: number;
  cornersA: boolean; // vertical combs: does this wall own the material phase at the corners?
  innerSpan: number; // length of the tab/notch comb region, centered between the corner columns
  notchEdge: "bottom" | "top" | "none"; // where the floor/top tabs enter
  dip?: { width: number; depth: number } | undefined; // thumb notch / side recess on the top edge
};

// Walk a wall's outline CCW from its bottom-left region: bottom edge (with tab notches), right
// corner comb, top edge (with dip and/or tab notches), left corner comb.
function wallOutline(s: WallSpec): Pt[] {
  const { W, H, t, kerf, cornersA } = s;
  const nV = fingerCount(H, s.fingerWidth);
  const v = combIntervals(H, nV, cornersA, kerf);
  const xIn = (i: number) => (v[i]!.finger ? 0 : t); // left-edge x for segment i
  const xOut = (i: number) => (v[i]!.finger ? W : W - t); // right-edge x for segment i

  // Tab comb over the inner span (B-phase intervals are the openings in the wall).
  const x0 = (W - s.innerSpan) / 2;
  const nT = fingerCount(s.innerSpan, s.fingerWidth);
  const tabs = combIntervals(s.innerSpan, nT, true, kerf).filter((iv) => !iv.finger);

  const pts: Pt[] = [];
  // Bottom edge, left → right.
  pts.push([xIn(0), 0]);
  if (s.notchEdge === "bottom") {
    for (const iv of tabs) {
      pts.push([x0 + iv.a, 0], [x0 + iv.a, t], [x0 + iv.b, t], [x0 + iv.b, 0]);
    }
  }
  pts.push([xOut(0), 0]);
  // Right corner comb, bottom → top.
  for (let i = 1; i < nV; i++) {
    pts.push([xOut(i - 1), v[i]!.a], [xOut(i), v[i]!.a]);
  }
  pts.push([xOut(nV - 1), H]);
  // Top edge, right → left.
  if (s.notchEdge === "top") {
    for (let k = tabs.length - 1; k >= 0; k--) {
      const iv = tabs[k]!;
      pts.push([x0 + iv.b, H], [x0 + iv.b, H - t], [x0 + iv.a, H - t], [x0 + iv.a, H]);
    }
  }
  if (s.dip && s.dip.width > 0 && s.dip.depth > 0) {
    pts.push(...dipPoints(W / 2, s.dip.width / 2, s.dip.depth, H));
  }
  pts.push([xIn(nV - 1), H]);
  // Left corner comb, top → bottom.
  for (let i = nV - 1; i > 0; i--) {
    pts.push([xIn(i), v[i]!.a], [xIn(i - 1), v[i]!.a]);
  }
  return dedupe(pts);
}

// Floor / cap-top: the inner rectangle plus through-wall tabs flush with the outer faces. Local
// origin is the OUTER footprint's min corner, so the inner rectangle starts at (t, t).
function slabOutline(iW: number, iD: number, t: number, kerf: number, fingerWidth: number): Pt[] {
  const tabsAlong = (len: number) =>
    combIntervals(len, fingerCount(len, fingerWidth), false, kerf).filter((iv) => iv.finger);
  const tw = tabsAlong(iW);
  const td = tabsAlong(iD);
  const pts: Pt[] = [];
  // Bottom edge (v = t), left → right, tabs dipping to v = 0.
  pts.push([t, t]);
  for (const iv of tw) pts.push([t + iv.a, t], [t + iv.a, 0], [t + iv.b, 0], [t + iv.b, t]);
  pts.push([t + iW, t]);
  // Right edge (u = t + iW), bottom → top, tabs out to u = 2t + iW.
  for (const iv of td)
    pts.push(
      [t + iW, t + iv.a],
      [2 * t + iW, t + iv.a],
      [2 * t + iW, t + iv.b],
      [t + iW, t + iv.b],
    );
  pts.push([t + iW, t + iD]);
  // Top edge, right → left.
  for (let k = tw.length - 1; k >= 0; k--) {
    const iv = tw[k]!;
    pts.push(
      [t + iv.b, t + iD],
      [t + iv.b, 2 * t + iD],
      [t + iv.a, 2 * t + iD],
      [t + iv.a, t + iD],
    );
  }
  pts.push([t, t + iD]);
  // Left edge, top → bottom.
  for (let k = td.length - 1; k >= 0; k--) {
    const iv = td[k]!;
    pts.push([t, t + iv.b], [0, t + iv.b], [0, t + iv.a], [t, t + iv.a]);
  }
  return dedupe(pts);
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) out.push(p);
  }
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) out.pop();
  return out;
}

// --- the ten panels --------------------------------------------------------------------------

const HALF_PI = Math.PI / 2;

export function panels(p: Params): Panel[] {
  const d = dims(p);
  const t = p.thickness;
  const { kerf, fingerWidth } = p;
  const notchW = p.notchWidth > 0 ? Math.min(p.notchWidth, d.innerW - 2 * fingerWidth) : 0;
  const recessW =
    p.sideRecessWidth > 0 ? Math.min(p.sideRecessWidth, d.innerD - 2 * fingerWidth) : 0;

  const wall = (
    id: string,
    W: number,
    H: number,
    cornersA: boolean,
    innerSpan: number,
    notchEdge: WallSpec["notchEdge"],
    place: Place,
    dip?: { width: number; depth: number },
  ): Panel => ({
    id,
    outline: wallOutline({ W, H, t, kerf, fingerWidth, cornersA, innerSpan, notchEdge, dip }),
    holes: [],
    size: [W, H],
    place,
  });

  // Cap offsets: the cap overhangs the body by t + capFit per side; its top face is at assembledH.
  const co = -(t + p.capFit);
  const capBot = d.bodyH - p.capDepth;

  return [
    // Body — wide walls own the corner material phase and carry the retrieval cutouts.
    wall(
      "body-front",
      d.bodyOuterW,
      d.bodyH,
      true,
      d.innerW,
      "bottom",
      { pos: [0, t, 0], rot: [HALF_PI, 0, 0] },
      notchW > 0 ? { width: notchW, depth: effectiveNotchDepth(p) } : undefined,
    ),
    wall("body-back", d.bodyOuterW, d.bodyH, true, d.innerW, "bottom", {
      pos: [0, d.bodyOuterD, 0],
      rot: [HALF_PI, 0, 0],
    }),
    wall(
      "body-left",
      d.bodyOuterD,
      d.bodyH,
      false,
      d.innerD,
      "bottom",
      { pos: [0, 0, 0], rot: [HALF_PI, 0, HALF_PI] },
      recessW > 0 ? { width: recessW, depth: Math.min(recessW / 2, p.capDepth) } : undefined,
    ),
    wall(
      "body-right",
      d.bodyOuterD,
      d.bodyH,
      false,
      d.innerD,
      "bottom",
      { pos: [d.bodyOuterW - t, 0, 0], rot: [HALF_PI, 0, HALF_PI] },
      recessW > 0 ? { width: recessW, depth: Math.min(recessW / 2, p.capDepth) } : undefined,
    ),
    {
      id: "body-floor",
      outline: slabOutline(d.innerW, d.innerD, t, kerf, fingerWidth),
      holes: [],
      size: [d.bodyOuterW, d.bodyOuterD],
      place: { pos: [0, 0, 0], rot: [0, 0, 0] },
    },
    // Cap — same joinery, tabs enter the walls' top edges, open rim at the bottom.
    wall("cap-front", d.capOuterW, d.capH, true, d.capInnerW, "top", {
      pos: [co, co + t, capBot],
      rot: [HALF_PI, 0, 0],
    }),
    wall("cap-back", d.capOuterW, d.capH, true, d.capInnerW, "top", {
      pos: [co, co + d.capOuterD, capBot],
      rot: [HALF_PI, 0, 0],
    }),
    wall("cap-left", d.capOuterD, d.capH, false, d.capInnerD, "top", {
      pos: [co, co, capBot],
      rot: [HALF_PI, 0, HALF_PI],
    }),
    wall("cap-right", d.capOuterD, d.capH, false, d.capInnerD, "top", {
      pos: [co + d.capOuterW - t, co, capBot],
      rot: [HALF_PI, 0, HALF_PI],
    }),
    {
      id: "cap-top",
      outline: slabOutline(d.capInnerW, d.capInnerD, t, kerf, fingerWidth),
      holes: [],
      size: [d.capOuterW, d.capOuterD],
      place: { pos: [co, co, d.assembledH - t], rot: [0, 0, 0] },
    },
  ];
}
