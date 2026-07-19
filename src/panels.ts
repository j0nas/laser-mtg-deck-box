// Panel geometry for the laser-cut MTG deck box: nine flat, kerf-compensated panels forming a
// finger-jointed box with a SLIDING LID in hidden grooves and a LID FRAME laminated on top of the
// lid. Pure 2D polygon math shared by the SVG export and the 3D preview.
//
// ---------------------------------------------------------------------------------------------
// CONSTRUCTION
// ---------------------------------------------------------------------------------------------
// World frame: the box occupies [0,outerW]×[0,outerD]×[0,wallH], Z up, front at y=0. t = thickness.
//
// The sides are LAMINATED, two layers each: an inner layer carrying the groove profile and a full
// outer layer, glued face-to-face at assembly. The groove (slotH tall, one layer deep, open at the
// front, stopped grooveStop + t short of the back face) is therefore fully hidden; the rail strip
// above it is glued to the outer layer along its whole length AND stays attached to the body
// through the grooveStop-wide ligament at the groove's back end — solid material inboard of the
// back comb's t-deep slot recesses, so no comb phase can ever sever the strip from the blank. The
// lid slides front-to-back in the two grooves (fully removable, as ever) and stops against the
// back wall's inner face; closed, its front edge is flush with the front face and it rests on the
// front wall's top edge. Its two BACK corners are relieved t × (grooveStop + lidFit) to clear the
// ligament bridges: the full-width centre of the back edge still sets the closed position on the
// back wall, and the relief shoulders sit lidFit short of the bridge faces, never bottoming first.
//
// Blanks: front and back walls span the full outerW and joint with 2t-deep fingers that pass
// through BOTH side layers (A-phase: material first). Both side layers of a side are identical
// parts (B-phase, t-deep combs); their front-edge comb only spans the front wall's height (slotZ),
// their back-edge comb the full wallH. The floor spans the cavity plus tabs that pass fully through
// the walls — t deep into front/back, 2t through the side sandwiches — finishing flush outside.
//
// The LID FRAME is a ninth, joint-free panel glued onto the lid's top face: a picture frame whose
// window recesses the foil marque one thickness deep behind a charred (laser-cut) border — the
// physical stand-in for the marque's old pinstripe frame — and whose top face lands flush with the
// wall tops (dims() shrinks the rail strip to t − lidFit exactly for this). It spans the recess
// between the two rail strips and never enters the grooves, so its blank is a plain rectangle: no
// combs, no corner reliefs. The window itself is ornamented (all free cuts): a LEGENDARY CROWN
// ARCH risen from its back edge, CATHEDRAL CUSPS in its corners, and the half-ellipse thumb
// scallop in its front edge — which is the new pull: a thumb drops into the window, catches the
// front edge and drags the lid open.
//
// The front and/or back wall can carry a THUMB NOTCH: a U-shaped scallop dipped into the top edge,
// centred and clear of the side joints, so a thumb reaches in to drag the top card up — exposing
// the facing card even with the lid closed. Both notches bottom out at the same world Z (the depth
// param is measured from the LID PLANE, slotZ), so the back wall's cut is deeper by wallH - slotZ.
// Trade-off of a back notch: it also opens a gap behind the closed lid's back edge and removes the
// lid's backstop over the notch width — the lid still stops on the flanking material either side,
// which is why the width clamp keeping the notch narrow matters.
//
// Kerf: see combBreakpoints — every internal finger/slot boundary shifts k/2 toward the slot, so
// joints press-fit while every panel's outer envelope stays exactly nominal. The lid has no joints:
// the laser's kerf makes a nominal-drawn lid ~k/2 smaller per edge, which only adds glide on top of
// lidFit.
//
// place: local outline points (u, v) extrude to (u, v, w), w ∈ [0, t]; then world =
// Rz(rot[2])·Ry(rot[1])·Rx(rot[0]) applied to the local point, plus pos. Consumers should not
// re-derive this: use applyPlace() (or placeMatrix() for a three.js Matrix4.fromArray).

import {
  circleCW,
  combIntervals,
  dedupe,
  fingerCount,
  type Panel,
  type Pt,
} from "parametric-kit/laser";
import { CAP, dims, type Params } from "./params.ts";

// The shared flat-panel primitives (types, comb math, placement transforms) live in
// parametric-kit/laser; re-exported so panel consumers and tests keep one import surface.
export {
  applyPlace,
  combBreakpoints,
  combIntervals,
  fingerCount,
  type Interval,
  isFinger,
  type Panel,
  type Place,
  placeMatrix,
  type Pt,
} from "parametric-kit/laser";

// --- lid flex latch --------------------------------------------------------------------------
//
// A cantilever spring cut into each inner side layer, just below the groove floor: a U-slot frees a
// tongue (anchored at the back) whose half-ellipse nub rises `latchBump` into the groove. The lid
// depresses it while sliding and it pops into a notch in the lid's side edge at the closed
// position — a hardware-free click, tuned by the bump height. All through-cuts, so the two inner
// layers stay identical parts.
export const LATCH = {
  freeEnd: 6, // tongue's free end, measured from the front face
  tongueL: 24,
  tongueW: 4,
  slotW: 1.5, // clearance under the tongue; comfortably exceeds the max bump deflection
  nubL: 8,
  notchSlack: 0.5, // lid notch is this much longer than the nub for a crisp seat
};

export type Latch = { uA: number; uNub: number; bump: number };

// Null when the latch is off or the box is too small to host the spring and the notch. The reach
// guard uses the groove's real (ligament-shortened) back end, so the tongue and its solid anchor
// always fit inside the actual groove run.
export function latchSpec(p: Params): Latch | null {
  if (p.latchBump <= 0) return null;
  const d = dims(p);
  const reach = d.outerD - p.thickness - d.grooveStop;
  if (reach < LATCH.freeEnd + LATCH.tongueL + 8) return null;
  if (d.lidL < LATCH.freeEnd + LATCH.nubL + 6) return null;
  return { uA: LATCH.freeEnd, uNub: LATCH.freeEnd + 2 + LATCH.nubL / 2, bump: p.latchBump };
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
  slot?: { z: number; h: number; reach: number; latch?: Latch | null } | undefined; // front-open groove (inner side layers)
  topNotch?: ThumbNotch | undefined; // U-shaped thumb scallop dipped into the top edge (wide walls)
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
  // Thumb notch: a downward U scalloped into the top edge, emitted here between the top-right and
  // top-left corners so it rides the right→left top-edge traversal. The interior is below the top
  // edge, so a dip downward is a correctly-wound cutout. Down the right flank, then a semicircular
  // bottom swept right → bottom → left (matching the walk), then up the left flank. When depth ===
  // halfW the flanks are zero-length and dedupe() collapses the coincident points.
  if (s.topNotch) {
    const { cx, halfW, depth } = s.topNotch;
    const yc = H - depth + halfW; // semicircle centre = top of each flank's straight run
    pts.push([cx + halfW, H], [cx + halfW, yc]);
    for (let i = 0; i <= 16; i++) {
      const th = (Math.PI * i) / 16;
      pts.push([cx + halfW * Math.cos(th), yc - halfW * Math.sin(th)]);
    }
    pts.push([cx - halfW, H]);
  }
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
      if (s.slot.latch) {
        // Walking the groove floor back-to-front: nub, free-end face, tongue underside back to the
        // anchor, then around the U-slot and up to rejoin the floor.
        const { uA, uNub, bump } = s.slot.latch;
        const z = s.slot.z;
        for (let i = 0; i <= 12; i++) {
          const th = (Math.PI * i) / 12;
          pts.push([uNub + (LATCH.nubL / 2) * Math.cos(th), z + bump * Math.sin(th)]);
        }
        const vT = z - LATCH.tongueW;
        pts.push(
          [uA, z],
          [uA, vT],
          [uA + LATCH.tongueL, vT],
          [uA + LATCH.tongueL, vT - LATCH.slotW],
          [uA - LATCH.slotW, vT - LATCH.slotW],
          [uA - LATCH.slotW, z],
        );
      }
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

// The lid: a rectangle with its two BACK corners relieved (t deep from each side edge, backCut =
// grooveStop + lidFit long from the back edge) so the closed lid clears the ligament bridges at
// the grooves' back ends — drawn nominal, the kerf only adds slack. The full-width centre of the
// back edge still sets the closed position against the back wall's inner face; the relief
// shoulders sit lidFit short of the bridge faces, so they never bottom out first. Plus a notch in
// each side edge that the latch nub pops into: it sits at the nub's closed position and is one
// wall-thickness deep — deeper than the nub column needs, so kerf and lidFit slack never keep the
// nub from seating.
function lidOutline(
  lidW: number,
  lidL: number,
  t: number,
  backCut: number,
  latch: Latch | null,
): Pt[] {
  const pts: Pt[] = [
    [0, 0],
    [lidW, 0],
  ];
  if (latch) {
    const v0 = latch.uNub - (LATCH.nubL + LATCH.notchSlack) / 2;
    const v1 = latch.uNub + (LATCH.nubL + LATCH.notchSlack) / 2;
    pts.push([lidW, v0], [lidW - t, v0], [lidW - t, v1], [lidW, v1]);
    pts.push([lidW, lidL - backCut], [lidW - t, lidL - backCut], [lidW - t, lidL]);
    pts.push([t, lidL], [t, lidL - backCut], [0, lidL - backCut]);
    pts.push([0, v1], [t, v1], [t, v0], [0, v0]);
  } else {
    pts.push([lidW, lidL - backCut], [lidW - t, lidL - backCut], [lidW - t, lidL]);
    pts.push([t, lidL], [t, lidL - backCut], [0, lidL - backCut]);
  }
  return dedupe(pts);
}

// --- the lid frame ----------------------------------------------------------------------------
//
// All in CAP-LOCAL mm, origin at the frame blank's min corner, y up — the same frame as the lid's,
// since the frame's front edge sits flush with the lid's front edge and both are centred across
// the recess. dims() already decided whether the frame fits (capW/capL are 0/0 otherwise), so this
// only lays out the window and its ornaments. The window is no plain rectangle: its BACK edge
// sweeps up into a LEGENDARY CROWN ARCH (concave wings to a peaked plateau — the Dominaria
// legendary-frame crown, echoing the foil crown it frames) and its corners are CATHEDRAL CUSPS —
// quarter arcs centred on the square corners, biting into the window like a gothic mat. Both only
// REMOVE frame material outward/at the corners, so the marque zone pays nothing for the arch and
// only a corner-diagonal inset (cusp/√2) for the cusps (see lidart's CAP_ART_MARGIN use).

export type CapWindow = { x0: number; y0: number; x1: number; y1: number };
export type CapScallop = { cx: number; halfW: number; depth: number }; // half-ellipse into the front rail
export type CapArch = { halfW: number; plateau: number; h: number; tip: number }; // centred on w/2
export type CapSpec = {
  w: number;
  l: number;
  window: CapWindow;
  scallop: CapScallop | null;
  arch: CapArch | null; // null -> straight back edge
  cusp: number; // corner cusp radius; 0 -> plain rounded corners (CAP.windowR)
};

// The crown arch's proportions, of the window width / of its own height. The peak rises
// rail − scallopLig above the window's back edge — the same ligament rule as the thumb scallop.
const ARCH_SPAN = 0.62;
const ARCH_PLATEAU = 0.15; // plateau half-width as a fraction of the arch span
const ARCH_TIP = 0.18; // centre-tip rise as a fraction of the total arch height

// Null when the frame is off or dims() dropped it (window below CAP.minWindow). Every ornament
// degrades independently: too skinny a rail and the scallop, arch or cusps quietly disappear —
// the plain window edge still works as the pull, just without the widened thumb landing.
export function capSpec(p: Params): CapSpec | null {
  const d = dims(p);
  if (d.capW <= 0) return null;
  const rail = p.capRail;
  const window: CapWindow = { x0: rail, y0: rail, x1: d.capW - rail, y1: d.capL - rail };
  const rise = rail - CAP.scallopLig; // room above/below the window edges, ligament kept
  let scallop: CapScallop | null = null;
  if (p.capScallop > 0) {
    const halfW = Math.min(p.capScallop, window.x1 - window.x0 - 8) / 2;
    const depth = Math.min(rise, halfW);
    if (halfW >= 3 && depth >= 1.2) scallop = { cx: d.capW / 2, halfW, depth };
  }
  let arch: CapArch | null = null;
  if (rise >= 1.2) {
    const halfW = (ARCH_SPAN * (window.x1 - window.x0)) / 2;
    arch = {
      halfW,
      plateau: ARCH_PLATEAU * 2 * halfW,
      h: rise * (1 - ARCH_TIP),
      tip: rise * ARCH_TIP,
    };
  }
  let cusp = Math.min(3, 0.45 * rail, (window.x1 - window.x0) / 6, (window.y1 - window.y0) / 6);
  if (cusp < 1) cusp = 0;
  return { w: d.capW, l: d.capL, window, scallop, arch, cusp };
}

const CORNER_SEGS = 6;
const WING_SEGS = 12;

// The window cutout: cathedral-cusped corners, the thumb scallop's half-ellipse dipped from the
// front edge into the front rail, and the legendary crown arch risen from the back edge into the
// back rail. Built CCW (interior kept left) and reversed at the end — panel holes are CW-wound.
// Like the pull hole, it is a standalone cutout drawn nominal: the kerf only widens it a hair.
// Exported (cap-local) because the marque layout traces this exact silhouette onto the lid foil
// as the frame's glue-peel guide — one source, so the trace can never drift from the real cut.
export function capWindowHole(spec: CapSpec): Pt[] {
  const { window: win, scallop, arch, cusp } = spec;
  const { x0, y0, x1, y1 } = win;
  const cx = spec.w / 2;
  const r = cusp > 0 ? cusp : Math.max(0, Math.min(CAP.windowR, (x1 - x0) / 2, (y1 - y0) / 2));
  const pts: Pt[] = [];
  // One corner, sweeping CCW along the boundary. Cusped corners centre the arc ON the square
  // corner (the arc bites into the window, locally clockwise = concave); rounded corners centre
  // it a radius inside (convex), the classic rounded rect.
  const corner = (qx: number, qy: number, a0: number, a1: number) => {
    for (let i = 0; i <= CORNER_SEGS; i++) {
      const th = a0 + ((a1 - a0) * i) / CORNER_SEGS;
      pts.push([qx + r * Math.cos(th), qy + r * Math.sin(th)]);
    }
  };
  // Corner arc centres and sweeps differ between the two styles: cusps pivot on the square
  // corners sweeping clockwise; rounds pivot one radius inside sweeping counter-clockwise.
  const atFL = () =>
    cusp > 0 ? corner(x0, y0, HALF_PI, 0) : corner(x0 + r, y0 + r, Math.PI, 3 * HALF_PI);
  const atFR = () =>
    cusp > 0 ? corner(x1, y0, Math.PI, HALF_PI) : corner(x1 - r, y0 + r, -HALF_PI, 0);
  const atBR = () =>
    cusp > 0 ? corner(x1, y1, -HALF_PI, -Math.PI) : corner(x1 - r, y1 - r, 0, HALF_PI);
  const atBL = () =>
    cusp > 0 ? corner(x0, y1, 0, -HALF_PI) : corner(x0 + r, y1 - r, HALF_PI, Math.PI);
  // Front edge, left → right, dipping through the scallop (widest at the edge, depth at centre).
  pts.push([x0 + r, y0]);
  if (scallop) {
    pts.push([scallop.cx - scallop.halfW, y0]);
    for (let i = 0; i <= 16; i++) {
      const th = (Math.PI * i) / 16;
      pts.push([scallop.cx - scallop.halfW * Math.cos(th), y0 - scallop.depth * Math.sin(th)]);
    }
  }
  pts.push([x1 - r, y0]);
  atFR();
  pts.push([x1, y1 - r]);
  atBR();
  // Back edge, right → left, rising through the crown arch: a concave wing (y grows with the
  // square of the run, leaving the straight edge tangentially), the peaked plateau, and the
  // mirrored wing back down.
  if (arch) {
    const { halfW, plateau, h, tip } = arch;
    const run = halfW - plateau;
    pts.push([cx + halfW, y1]);
    for (let i = 1; i <= WING_SEGS; i++) {
      const u = i / WING_SEGS;
      pts.push([cx + halfW - u * run, y1 + h * u * u]);
    }
    pts.push([cx, y1 + h + tip]);
    for (let i = WING_SEGS; i >= 1; i--) {
      const u = i / WING_SEGS;
      pts.push([cx - halfW + u * run, y1 + h * u * u]);
    }
    pts.push([cx - halfW, y1]);
  }
  pts.push([x0 + r, y1]);
  atBL();
  pts.push([x0, y0 + r]);
  atFL();
  return dedupe(pts.reverse());
}

export type PullHole = { cx: number; cy: number; r: number };

// The lid pull hole in lid-local mm (origin at the lid blank's min corner, y up). Null when the
// pull is disabled or too small to bother cutting. This is the ONE source of the hole spec: the
// panel geometry below AND the lid-art layout (lidart.ts) both read it, so the engraved marque can
// never drift into the real cut. Kept in step with the lid blank via dims(): the hole sits centred
// across the width, one radius + 4 mm up from the front edge (min 14 mm so a fingertip clears).
// With the lid frame on it also rides above the window's front rail (frame and lid share y = 0),
// so the peek hole stays fully visible inside the window instead of hiding under the frame.
export function pullHole(p: Params): PullHole | null {
  const d = dims(p);
  const pull = Math.min(p.lidPull, d.lidW - 8, d.lidL - 8);
  if (pull < 4) return null;
  const cap = capSpec(p);
  const cy = Math.max(pull / 2 + 4, 14, cap ? cap.window.y0 + 1 + pull / 2 : 0);
  if (cy + pull / 2 > d.lidL - 3) return null; // the frame pushed it off the lid: skip the hole
  return { cx: d.lidW / 2, cy, r: pull / 2 };
}

export type ThumbNotch = { cx: number; halfW: number; depth: number };

// The thumb notch: a U-shaped scallop dipped into a wide wall's TOP edge, centred across outerW,
// so a thumb reaches past the top card and drags the stack up — the classic deck-box notch, and it
// exposes the facing card even with the lid closed. Null when off or too small to bother. The spec
// is LID-PLANE-RELATIVE: `depth` measures how far the notch dips below slotZ, which is the front
// wall's own top edge — panels() converts to each wall's local depth (the taller back wall adds
// wallH - slotZ), so front and back notches bottom out at the same world Z and expose the same
// amount of card face. Like the lid pull hole this is a standalone cutout, so it is drawn nominal
// (no kerf shift) — the laser only widens it a hair. Width is clamped to keep the notch clear of
// the side finger joints; depth is a U with a semicircular bottom, which needs depth >= halfW, and
// is then clamped to leave a strip of wall standing below it (this bound already covers both walls,
// since both bottoms share that world Z).
export function thumbNotch(p: Params): ThumbNotch | null {
  if (p.notchWidth <= 0) return null;
  const d = dims(p);
  const halfW = Math.min(p.notchWidth, d.innerW - 6) / 2;
  if (halfW < 3) return null;
  let depth = Math.max(p.notchDepth, halfW); // a semicircular bottom can't be shallower than its radius
  depth = Math.min(depth, d.slotZ - p.thickness - 8); // leave a strip of wall below the notch
  if (depth < halfW) return null;
  return { cx: d.outerW / 2, halfW, depth };
}

// --- the nine panels -------------------------------------------------------------------------

const HALF_PI = Math.PI / 2;

export function panels(p: Params): Panel[] {
  const d = dims(p);
  const t = p.thickness;
  const { kerf, fingerWidth } = p;
  const latch = latchSpec(p);
  const cap = capSpec(p);

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
      // The groove stops grooveStop short of the back comb's slot recesses (which reach t deep, to
      // u = outerD - t): that ligament ties the rail strip to the body in solid material whatever
      // the comb phase, so the inner layer can never shed its strip as a separate part.
      slot: grooved
        ? { z: d.slotZ, h: d.slotH, reach: d.outerD - t - d.grooveStop, latch }
        : undefined,
    }),
    holes: [],
    size: [d.outerD, d.wallH],
    place: { pos: [x, 0, 0], rot: [HALF_PI, 0, HALF_PI] },
  });

  const wideWall = (id: string, H: number, y: number, topNotch?: ThumbNotch): Panel => ({
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
      topNotch,
    }),
    holes: [],
    size: [d.outerW, H],
    place: { pos: [0, y, 0], rot: [HALF_PI, 0, 0] },
  });

  const hole = pullHole(p);
  const lidHoles: Pt[][] = hole ? [circleCW(hole.cx, hole.cy, hole.r)] : [];

  // The notch spec is lid-plane-relative; convert per wall. The front wall's top edge IS the lid
  // plane, so it takes the spec as-is; the back wall is taller by wallH - slotZ, so its cut deepens
  // by that much — both notches bottom out at the same world Z. The semicircle-floor invariant
  // (depth >= halfW) only needs to hold lid-plane-relative: the back's larger depth just means
  // longer straight flanks above the same half-round.
  const notch = thumbNotch(p);
  const frontNotch = notch && p.notchWalls !== "back" ? notch : undefined;
  const backNotch =
    notch && p.notchWalls !== "front"
      ? { ...notch, depth: notch.depth + (d.wallH - d.slotZ) }
      : undefined;

  return [
    wideWall("body-front", d.slotZ, t, frontNotch),
    wideWall("body-back", d.wallH, d.outerD, backNotch),
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
      outline: lidOutline(d.lidW, d.lidL, t, d.grooveStop + p.lidFit, latch),
      holes: lidHoles,
      size: [d.lidW, d.lidL],
      place: { pos: [(d.outerW - d.lidW) / 2, 0, d.slotZ], rot: [0, 0, 0] },
    },
    // The lid frame laminates onto the lid's top face, centred in the recess between the rail
    // strips, front edges flush — with the frame-shrunk rail strip its own top face meets the
    // wall tops exactly (slotZ + 2t = wallH).
    ...(cap
      ? [
          {
            id: "lid-cap",
            outline: [
              [0, 0],
              [cap.w, 0],
              [cap.w, cap.l],
              [0, cap.l],
            ] as Pt[],
            holes: [capWindowHole(cap)],
            size: [cap.w, cap.l] as [number, number],
            place: {
              pos: [(d.outerW - cap.w) / 2, 0, d.slotZ + t] as [number, number, number],
              rot: [0, 0, 0] as [number, number, number],
            },
          },
        ]
      : []),
  ];
}
