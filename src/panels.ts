// Panel geometry for the laser-cut MTG deck box: eight flat, kerf-compensated panels forming a
// finger-jointed box with a SLIDING LID in hidden grooves. Pure 2D polygon math shared by the SVG
// export and the 3D preview.
//
// ---------------------------------------------------------------------------------------------
// CONSTRUCTION
// ---------------------------------------------------------------------------------------------
// World frame: the box occupies [0,outerW]×[0,outerD]×[0,wallH], Z up, front at y=0. t = thickness.
//
// The sides are LAMINATED, two layers each: an inner layer carrying the groove profile and a full
// outer layer, glued face-to-face at assembly. The groove (slotH tall, one layer deep, open at the
// front, stopped t short of the back face) is therefore fully hidden; the rail strip above it is
// glued to the outer layer along its whole length, so it is never a free-hanging bridge. The lid
// slides front-to-back in the two grooves and stops against the back wall's inner face; closed, its
// front edge is flush with the front face and it rests on the front wall's top edge.
//
// Blanks: front and back walls span the full outerW and joint with 2t-deep fingers that pass
// through BOTH side layers (A-phase: material first). Both side layers of a side are identical
// parts (B-phase, t-deep combs); their front-edge comb only spans the front wall's height (slotZ),
// their back-edge comb the full wallH. The floor spans the cavity plus tabs that pass fully through
// the walls — t deep into front/back, 2t through the side sandwiches — finishing flush outside.
//
// Kerf: see combBreakpoints — every internal finger/slot boundary shifts k/2 toward the slot, so
// joints press-fit while every panel's outer envelope stays exactly nominal. The lid has no joints:
// the laser's kerf makes a nominal-drawn lid ~k/2 smaller per edge, which only adds glide on top of
// lidFit.
//
// place: local outline points (u, v) extrude to (u, v, w), w ∈ [0, t]; then world =
// Rz(rot[2])·Ry(rot[1])·Rx(rot[0]) applied to the local point, plus pos. Consumers should not
// re-derive this: use applyPlace() (or placeMatrix() for a three.js Matrix4.fromArray).

import { dims, type Params } from "./params.ts";

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

type EdgeComb = {
  len: number; // comb runs from v=0 to len; above it the edge is plain at the blank's face
  firstIsA: boolean;
  depth: number; // how far a slot recesses into the blank
};

type WallSpec = {
  W: number;
  H: number;
  t: number;
  kerf: number;
  fingerWidth: number;
  left: EdgeComb;
  right: EdgeComb;
  notchSpan: number; // floor-tab comb region, centered; 0 = no bottom notches
  slot?: { z: number; h: number; reach: number } | undefined; // front-open groove (inner side layers)
};

// Walk a wall outline CCW: bottom edge (with floor-tab notches), right comb up, plain rise to the
// top, top edge right-to-left, plain drop on the left (through the groove, when present), left comb
// down. Combs may stop below the top edge (len < H): the blank continues at its own face above.
function wallOutline(s: WallSpec): Pt[] {
  const { W, H, t, kerf } = s;
  const combOf = (e: EdgeComb) =>
    combIntervals(e.len, fingerCount(e.len, s.fingerWidth), e.firstIsA, kerf);
  const L = combOf(s.left);
  const R = combOf(s.right);
  const xL = (i: number) => (L[i]!.finger ? 0 : s.left.depth);
  const xR = (i: number) => (R[i]!.finger ? W : W - s.right.depth);

  const x0 = (W - s.notchSpan) / 2;
  const tabs =
    s.notchSpan > 0
      ? combIntervals(s.notchSpan, fingerCount(s.notchSpan, s.fingerWidth), true, kerf).filter(
          (iv) => !iv.finger,
        )
      : [];

  const pts: Pt[] = [];
  // Bottom edge, left → right.
  pts.push([xL(0), 0]);
  for (const iv of tabs) pts.push([x0 + iv.a, 0], [x0 + iv.a, t], [x0 + iv.b, t], [x0 + iv.b, 0]);
  pts.push([xR(0), 0]);
  // Right comb, bottom → top (always full height: the back corner runs the whole wall).
  for (let i = 1; i < R.length; i++) pts.push([xR(i - 1), R[i]!.a], [xR(i), R[i]!.a]);
  pts.push([xR(R.length - 1), H]);
  // Top edge right → left, then down the left side. A short left comb (len < H) means the blank
  // face continues plain above it — optionally interrupted by the front-open groove, whose bottom
  // face lands exactly on the comb's top corner (slot.z === left.len).
  if (s.left.len < H - 1e-9) {
    pts.push([0, H]);
    if (s.slot) {
      pts.push(
        [0, s.slot.z + s.slot.h],
        [s.slot.reach, s.slot.z + s.slot.h],
        [s.slot.reach, s.slot.z],
      );
    } else {
      pts.push([0, s.left.len]);
    }
  }
  pts.push([xL(L.length - 1), s.left.len]);
  for (let i = L.length - 1; i > 0; i--) pts.push([xL(i), L[i]!.a], [xL(i - 1), L[i]!.a]);
  return dedupe(pts);
}

// Floor: the cavity rectangle plus through-wall tabs flush with the outer faces — t deep at the
// front/back edges, `dx` (2t) deep at the side edges through the laminated sandwich. Local origin
// is the OUTER footprint's min corner, so the cavity rectangle starts at (dx, t).
function floorOutline(
  iW: number,
  iD: number,
  dx: number,
  t: number,
  kerf: number,
  fw: number,
): Pt[] {
  const tabsAlong = (len: number) =>
    combIntervals(len, fingerCount(len, fw), false, kerf).filter((iv) => iv.finger);
  const tw = tabsAlong(iW);
  const td = tabsAlong(iD);
  const pts: Pt[] = [];
  // Front edge (v = t), left → right, tabs dipping to v = 0.
  pts.push([dx, t]);
  for (const iv of tw) pts.push([dx + iv.a, t], [dx + iv.a, 0], [dx + iv.b, 0], [dx + iv.b, t]);
  pts.push([dx + iW, t]);
  // Right edge, bottom → top, tabs out to u = dx + iW + dx.
  for (const iv of td)
    pts.push(
      [dx + iW, t + iv.a],
      [2 * dx + iW, t + iv.a],
      [2 * dx + iW, t + iv.b],
      [dx + iW, t + iv.b],
    );
  pts.push([dx + iW, t + iD]);
  // Back edge, right → left.
  for (let k = tw.length - 1; k >= 0; k--) {
    const iv = tw[k]!;
    pts.push(
      [dx + iv.b, t + iD],
      [dx + iv.b, 2 * t + iD],
      [dx + iv.a, 2 * t + iD],
      [dx + iv.a, t + iD],
    );
  }
  pts.push([dx, t + iD]);
  // Left edge, top → bottom.
  for (let k = td.length - 1; k >= 0; k--) {
    const iv = td[k]!;
    pts.push([dx, t + iv.b], [0, t + iv.b], [0, t + iv.a], [dx, t + iv.a]);
  }
  return dedupe(pts);
}

const HOLE_SEGS = 24;

function circleCW(cx: number, cy: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < HOLE_SEGS; i++) {
    const th = (-2 * Math.PI * i) / HOLE_SEGS; // negative sweep -> CW hole winding
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
  }
  return pts;
}

// --- the eight panels ------------------------------------------------------------------------

const HALF_PI = Math.PI / 2;

export function panels(p: Params): Panel[] {
  const d = dims(p);
  const t = p.thickness;
  const { kerf, fingerWidth } = p;

  // Both layers of a side are the same part; the combs differ per edge, not per layer.
  const sideLayer = (id: string, x: number, grooved: boolean): Panel => ({
    id,
    outline: wallOutline({
      W: d.outerD,
      H: d.wallH,
      t,
      kerf,
      fingerWidth,
      left: { len: d.slotZ, firstIsA: false, depth: t }, // front corner: comb only up to the front wall's top
      right: { len: d.wallH, firstIsA: false, depth: t }, // back corner: full height
      notchSpan: d.innerD,
      slot: grooved ? { z: d.slotZ, h: d.slotH, reach: d.outerD - t } : undefined,
    }),
    holes: [],
    size: [d.outerD, d.wallH],
    place: { pos: [x, 0, 0], rot: [HALF_PI, 0, HALF_PI] },
  });

  const wideWall = (id: string, H: number, y: number): Panel => ({
    id,
    outline: wallOutline({
      W: d.outerW,
      H,
      t,
      kerf,
      fingerWidth,
      left: { len: H, firstIsA: true, depth: 2 * t }, // fingers pass through both side layers
      right: { len: H, firstIsA: true, depth: 2 * t },
      notchSpan: d.innerW,
    }),
    holes: [],
    size: [d.outerW, H],
    place: { pos: [0, y, 0], rot: [HALF_PI, 0, 0] },
  });

  const pull = Math.min(p.lidPull, d.lidW - 8, d.lidL - 8);
  const lidHoles: Pt[][] =
    pull >= 4 ? [circleCW(d.lidW / 2, Math.max(pull / 2 + 4, 14), pull / 2)] : [];

  return [
    wideWall("body-front", d.slotZ, t),
    wideWall("body-back", d.wallH, d.outerD),
    sideLayer("side-left-outer", 0, false),
    sideLayer("side-left-inner", t, true),
    sideLayer("side-right-inner", d.outerW - 2 * t, true),
    sideLayer("side-right-outer", d.outerW - t, false),
    {
      id: "body-floor",
      outline: floorOutline(d.innerW, d.innerD, 2 * t, t, kerf, fingerWidth),
      holes: [],
      size: [d.outerW, d.outerD],
      place: { pos: [0, 0, 0], rot: [0, 0, 0] },
    },
    {
      id: "lid",
      outline: [
        [0, 0],
        [d.lidW, 0],
        [d.lidW, d.lidL],
        [0, d.lidL],
      ],
      holes: lidHoles,
      size: [d.lidW, d.lidL],
      place: { pos: [(d.outerW - d.lidW) / 2, 0, d.slotZ], rot: [0, 0, 0] },
    },
  ];
}
