// Wall engravings ("side art"): the parametric PATTERN engine for the decorative engravings on
// the four visible walls — front, right, back, left. PURE and DOM-free, like lidart.ts: one
// element list drives the SVG export (svg.ts), the 3D preview overlay (main.ts) and the tests.
// All geometry is in PANEL-LOCAL millimetres, y up, origin at the panel blank's min corner —
// which, for every decorated wall, is also the wall's VIEW frame (x to the right as seen from
// outside the box): each decorated panel is drawn engrave-face-up, and the rigid motion that
// assembles it with the engraving outward maps drawn coordinates to view coordinates identically
// (panels.ts mirrors the left outer layer for exactly this reason).
//
// ---------------------------------------------------------------------------------------------
// COMPOSITION (per wall)
// ---------------------------------------------------------------------------------------------
// Two layouts share one pattern engine. FRAMED (the default): a thin BORDER pinstripe rides one
// uniform margin inside the finger joints (rounded corners like a card's die-cut), and the chosen
// PATTERN fills the field inside it. FULL: no border, no margins — the pattern tiles the whole
// blank and is cropped to the panel's REAL cut outline (combs, floor notches and the thumb notch
// included), so the linework bleeds to every cut edge and wraps onto the corner fingers without
// ever landing on a slot recess — scrap on the sheet, the neighbour wall's bare end grain on the
// box. Everything is thin engraved
// LINEWORK, never filled areas — engraved lines are what read as crafted on bare wood (filled
// fields char muddy and raster for an hour), so each pattern is generated as centreline geometry
// over the field's bbox, stroked into closed bands (heal.ts strokeRings — LightBurn ignores
// stroke-width, so a "line" must ship as a filled region) and cropped to the field with one
// Clipper intersection. On a framed wall with a THUMB NOTCH both border and pattern keep clear of
// the cut (region difference against a dilated keep-out), so the notch reads as deliberate, not as
// a bite out of the ornament; the full layout instead lets every cut bite the pattern equally, the
// notch included.
//
// The patterns:
//   • lattice     — diamond pinstripes at ±45°, the classic humidor lid treatment.
//   • chevron     — stacked zigzag pinstripes, peaks aligned in columns: the French parquet.
//   • herringbone — columns of parallel ±45° ribs, adjacent columns mirrored and offset half a
//                   step: the broken-twill seam of woven cloth and parquet floors.
//   • yabane      — the Japanese arrow-fletching: columns of nested feather chevrons between
//                   fine rules, adjacent columns opposed and half-stepped, the meisen classic.
//   • basketweave — square cells of three strokes alternating warp and weft, the woven mat.
//   • meander     — the Greek key: running-fret bands, each ONE continuous line folding into
//                   its hooks, bracketed by rail pinstripes — the carved-border classic.
//   • guilloche   — engine turning's torsade: two antiphase sine strands per band crossing
//                   into a chain of lenses, bands stacked with the lenses bricked.
//   • tatewaku    — the Japanese rising-steam: vertical undulating lines, neighbours in
//                   antiphase, so the gaps between them swell and pinch in alternating barrels.
//   • starcross   — the Islamic star-and-cross, both voices drawn: eight-point khatam stars
//                   on a grid and a Greek cross in every void, separated by a grout-line gap.
//   • kagome      — the Japanese woven-bamboo lattice: three straight-line families at 60°,
//                   the third half-stepped so crossings stay pairwise, every strand woven
//                   over-under (the under strand breaks) by a propagated alternation.
//   • hitomezashi — one-stitch sashiko: single dashes on a square grid, row and column phase
//                   words making the classic persimmon-flower motif emerge from the crossings.
//   • sunburst    — Art-Deco fan: rays bursting from a hub on the field's bottom edge over
//                   nested half-arcs — the rising-sun marquetry motif.
//   • ogee        — mirrored sine columns kissing into stacked pointed lanterns: gothic tracery
//                   by way of the Moroccan trellis, echoing the lid frame's cathedral cusps.
//   • seigaiha    — the Japanese overlapping wave fans: concentric-arc scales shingled so each
//                   row clips the rows behind. Every interior scale shows the identical
//                   silhouette, so the clipped shape is built ONCE and stamped across the grid.
//   • asanoha     — the Japanese hemp-leaf star lattice: a triangular grid with centroid spokes.
//   • kikko       — the Japanese tortoiseshell hexagon lattice, drawn flat-topped.
//   • shippo      — the Japanese "seven treasures": interlocking circles overlapping into
//                   four-petal flowers between curved diamonds.
//   • dunes       — flowing horizontal contour lines whose amplitude, wavelength and phase
//                   drift deterministically row by row — the organic counterpoint.
//   • mana        — the commander's colour identity tiled as a luxury monogram: the real
//                   Scryfall glyphs, small and row-staggered, cycling through the identity
//                   diagonally. Whole glyphs only — an edge-cropped symbol engraves as debris.
//
// Everything is pass "engrave" (dark char): foil on the walls is out of scope by design — the
// research behind this module was unanimous that engraved linework is what looks crafted on bare
// wood, while filled/foiled areas read as decals. Degradation: a field too small for its pattern
// keeps the border alone; a wall too small for even that stays plain; a mana wall without an
// identity or glyph data keeps the border (a data gap, not a policy — same rule as the lid coins).
// The full layout has no border to fall back on, so its degradations go straight to plain.

import { clipRings, offsetRings, type Pair, type Ring, ringsArea, strokeRings } from "./heal.ts";
import {
  type Bbox,
  healedCoin,
  type LidArt,
  type LidArtElement,
  ringsToPath,
  type SideStyle,
} from "./lidart.ts";
import { panels, type ThumbNotch, thumbNotch } from "./panels.ts";
import { dims, type Params } from "./params.ts";

export type WallId = "body-front" | "side-right-outer" | "body-back" | "side-left-outer";

// One decorated wall: elements in panel-local (= view) mm, plus what the preview needs to hang
// the art on the right face of the placed panel. artFace names the local face that carries the
// engraving once the panel sits in the assembled box: "top" = the extrusion's w = t face, drawn
// orientation; "bottom" = the w = 0 face — the panel is assembled flipped (its outline permits
// it), so the preview shows the art on the back face, mirrored by the flip itself.
export type WallArt = {
  panelId: WallId;
  artFace: "top" | "bottom";
  w: number;
  h: number;
  elements: LidArtElement[];
};

// --- proportions -------------------------------------------------------------------------------

const BORDER_W = 0.5; // border pinstripe weight
const BORDER_R = 3.5; // border corner radius — a card's die-cut corner
const EDGE_EXTRA = 1.2; // border margin beyond the deepest joint reach (2t)
const NOTCH_CLEAR = 1.3; // the border keeps this much air off the thumb-notch cut edge
const FIELD_GAP = 1.8; // air between the border's inner edge and the pattern field
const PATTERN_W = 0.45; // pattern band weight
const MIN_FRAME = 24; // below this border span, the wall stays plain
const MIN_FIELD = 14; // below this field span, the border stands alone
const FRAGMENT_MIN_AREA = 0.5; // mm² — cropping debris below this chars as specks, so it drops

// Drop degenerate band slivers left by a boolean crop (sub-millimetre arc tips at the field edge
// or the notch keep-out). Holes are always contained in a same-or-larger outer, so an area filter
// can never orphan one that matters.
function dropFragments(rings: Ring[]): Ring[] {
  return rings.filter((r) => Math.abs(ringsArea([r])) >= FRAGMENT_MIN_AREA);
}

// The uniform border margin from every panel edge. 2t covers the deepest joint on any wall (the
// wide walls' through-finger slots and the end grain of the mating fingers; the side walls' t-deep
// combs and the floor tabs sit well inside it), and ONE margin for all walls keeps the borders
// reading as a matched set around the box.
export function wallMargin(t: number): number {
  return 2 * t + EDGE_EXTRA;
}

// --- geometry helpers --------------------------------------------------------------------------

function ringsBbox(rings: Ring[]): Bbox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

const CORNER_SEGS = 8;

// A rounded rectangle as a CCW polygon ring (r = 0 -> sharp corners).
function roundedRectRing(x0: number, y0: number, x1: number, y1: number, r: number): Ring {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (rr <= 1e-6) {
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  const pts: Ring = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= CORNER_SEGS; i++) {
      const th = a0 + (Math.PI / 2) * (i / CORNER_SEGS);
      pts.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th)]);
    }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  return pts;
}

// A circle as a CCW polygon ring.
function circleRing(cx: number, cy: number, r: number, segs: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < segs; i++) {
    const th = (2 * Math.PI * i) / segs;
    ring.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
  }
  return ring;
}

// The notch's overlap-test box for the seigaiha stamp split: a stamp touching it must pay for the
// crop. `clear` dilates it to match whatever region the caller actually subtracts (0 in the full
// layout, where the outline itself carries the cut).
type NotchBox = { x0: number; x1: number; y0: number };

function notchBox(n: ThumbNotch, H: number, clear: number): NotchBox {
  return { x0: n.cx - n.halfW - clear, x1: n.cx + n.halfW + clear, y0: H - n.depth - clear };
}

// The thumb notch's keep-out: the notch cut dilated by `clear` — straight flanks reaching safely
// above the panel's top edge, a parallel semicircular bottom, wound CCW so it clips directly.
// Border and pattern are routed around this region so the engraving never runs into the cut edge.
function notchKeepout(n: ThumbNotch, H: number, clear: number): Ring {
  const R = n.halfW + clear;
  const yc = H - n.depth + n.halfW; // same centre as the cut's semicircular bottom
  const pts: Ring = [[n.cx - R, H + 2]];
  for (let i = 0; i <= 24; i++) {
    const th = Math.PI - (Math.PI * i) / 24;
    pts.push([n.cx + R * Math.cos(th), yc - R * Math.sin(th)]);
  }
  pts.push([n.cx + R, H + 2]);
  return pts;
}

// Distance from a point outside the U-shaped notch cut to the cut's edge: the flank metric above
// the semicircle centre, the radial metric below it. Used to place whole mana glyphs clear of the
// cut without any clipping.
function notchDist(n: ThumbNotch, H: number, x: number, y: number): number {
  const yc = H - n.depth + n.halfW;
  if (y >= yc) return Math.abs(x - n.cx) - n.halfW;
  return Math.hypot(x - n.cx, y - yc) - n.halfW;
}

// One closed pinstripe loop: the band between `outer` and its inward parallel at `w`, routed
// around the keep-out when one is given. Null when the boundary degenerates (erosion swallowed
// it) — the caller just drops the border.
function pinstripe(id: string, outer: Ring, w: number, keepout: Ring | null): LidArtElement | null {
  const region = keepout ? clipRings("difference", [outer], [keepout]) : [outer];
  if (region.length === 0) return null;
  const inner = offsetRings(region, -w);
  if (inner.length === 0) return null;
  return {
    id,
    pass: "engrave",
    paths: [ringsToPath(region, 0, 0), ringsToPath(inner, 0, 0)],
    fillRule: "evenodd",
    bbox: ringsBbox(region),
  };
}

// --- pattern generators ------------------------------------------------------------------------
//
// Each generator returns finished BAND rings (Clipper-oriented) covering the field's bbox with a
// little overshoot; the caller crops them to the field region in one intersection, so generators
// never worry about edges or the notch.

// Diamond pinstripe lattice: two families of parallel lines at ±45°.
function latticeBands(f: Bbox): Ring[] {
  const S = 8; // perpendicular pinstripe spacing
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0) / 2 + 2; // half-length: corner to corner
  const kMax = Math.ceil(L / S);
  const lines: Ring[] = [];
  for (const dy of [Math.SQRT1_2, -Math.SQRT1_2]) {
    const dx = Math.SQRT1_2;
    for (let k = -kMax; k <= kMax; k++) {
      const ox = cx - dy * k * S; // (-dy, dx) is the line direction's perpendicular
      const oy = cy + dx * k * S;
      lines.push([
        [ox - dx * L, oy - dy * L],
        [ox + dx * L, oy + dy * L],
      ]);
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Art-Deco sunburst: nested half-arcs around a hub on the field's bottom edge, rays fanning out
// past the far corners. Rays start clear of the hub so their convergence never chars solid.
function sunburstBands(f: Bbox): Ring[] {
  const cx = (f.x0 + f.x1) / 2;
  const cy = f.y0;
  const lines: Ring[] = [];
  for (const r of [3.2, 6.2, 9.2]) {
    const arc: Ring = [];
    for (let i = 0; i <= 36; i++) {
      const th = (Math.PI * i) / 36;
      arc.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    }
    lines.push(arc);
  }
  const r0 = 12.4;
  const r1 = Math.hypot((f.x1 - f.x0) / 2, f.y1 - f.y0) + 2;
  const rays = 17;
  for (let i = 0; i < rays; i++) {
    const th = (Math.PI * (i + 0.5)) / rays; // half-step offset: no ray grazes the bottom edge
    lines.push([
      [cx + r0 * Math.cos(th), cy + r0 * Math.sin(th)],
      [cx + r1 * Math.cos(th), cy + r1 * Math.sin(th)],
    ]);
  }
  return strokeRings(lines, PATTERN_W);
}

// --- seigaiha ----------------------------------------------------------------------------------
//
// Circles of radius R on a grid with x-period 2R, y-period R/2 and alternate rows shifted by R,
// lower rows shingling the ones behind. A scale's visible silhouette is its concentric bands
// minus the three discs in front of it: the two row-below neighbours at (±R, −R/2) and the scale
// two rows down at (0, −R) — beyond those the shape repeats, so every interior scale is this one
// master stamped in place.

const SG_R = 8; // scale radius; fans read ~14 mm wide
const SG_RADII = [1, 0.68, 0.36]; // concentric arc bands per scale, as fractions of R

let sgMaster: { rings: Ring[]; bbox: Bbox } | null = null;

function seigaihaMaster(): { rings: Ring[]; bbox: Bbox } {
  if (sgMaster) return sgMaster;
  const R = SG_R;
  const bands = strokeRings(
    SG_RADII.map((fr) => circleRing(0, 0, fr * R, 28)),
    PATTERN_W,
    true,
  );
  const front = [
    circleRing(-R, -R / 2, R, 40),
    circleRing(R, -R / 2, R, 40),
    circleRing(0, -R, R, 40),
  ];
  const rings = dropFragments(clipRings("difference", bands, front));
  sgMaster = { rings, bbox: ringsBbox(rings) };
  return sgMaster;
}

// Master stamps over the `cover` grid, pre-split for the crop: a stamp wholly inside `safe` (and
// clear of the notch box) skips the Clipper intersection entirely — only the boundary ring
// of stamps pays for clipping, which keeps a full seigaiha wall rebuild in single-digit ms.
// `safe` must be provably solid, in-region material: the framed field itself, or the blank inset
// past the deepest joint recess in the full layout.
function seigaihaScales(
  cover: Bbox,
  safe: Bbox,
  kb: NotchBox | null,
): { inside: Ring[]; boundary: Ring[] } {
  const R = SG_R;
  const master = seigaihaMaster();
  const inside: Ring[] = [];
  const boundary: Ring[] = [];
  let j = 0;
  for (let y = cover.y0 - R; y <= cover.y1 + R; y += R / 2, j++) {
    const off = j % 2 === 1 ? R : 0;
    for (let x = cover.x0 - R + off; x <= cover.x1 + R; x += 2 * R) {
      const bb = {
        x0: master.bbox.x0 + x,
        y0: master.bbox.y0 + y,
        x1: master.bbox.x1 + x,
        y1: master.bbox.y1 + y,
      };
      if (bb.x1 < cover.x0 || bb.x0 > cover.x1 || bb.y1 < cover.y0 || bb.y0 > cover.y1) continue;
      const clipped =
        bb.x0 < safe.x0 ||
        bb.x1 > safe.x1 ||
        bb.y0 < safe.y0 ||
        bb.y1 > safe.y1 ||
        (kb != null && bb.x1 >= kb.x0 && bb.x0 <= kb.x1 && bb.y1 >= kb.y0);
      const target = clipped ? boundary : inside;
      for (const ring of master.rings) {
        target.push(ring.map(([px, py]): Pair => [px + x, py + y]));
      }
    }
  }
  return { inside, boundary };
}

// Asanoha (hemp leaf): the triangular lattice with every triangle's centroid spoked to its three
// vertices. Each up-triangle contributes its own edges (every lattice edge belongs to exactly one
// up-triangle) plus its spokes; down-triangles add only spokes.
function asanohaBands(f: Bbox): Ring[] {
  const s = 13; // triangle side — stars read ~13 mm across
  const h = (s * Math.sqrt(3)) / 2;
  const lines: Ring[] = [];
  const jMax = Math.ceil((f.y1 - f.y0) / h) + 1;
  const reach = Math.ceil((f.x1 - f.x0) / s) + 2;
  for (let j = -1; j <= jMax; j++) {
    const y = f.y0 + j * h;
    const off = ((j % 2) + 2) % 2 === 1 ? s / 2 : 0;
    for (let i = -2; i <= reach; i++) {
      const x = f.x0 + i * s + off;
      const ax = x + s / 2; // up-triangle apex
      const ay = y + h;
      lines.push(
        [
          [x, y],
          [x + s, y],
        ],
        [
          [x, y],
          [ax, ay],
        ],
        [
          [x + s, y],
          [ax, ay],
        ],
      );
      const g1: Pair = [x + s / 2, y + h / 3]; // up-triangle centroid
      lines.push([[x, y], g1], [[x + s, y], g1], [[ax, ay], g1]);
      const g2: Pair = [x + s, y + (2 * h) / 3]; // down-triangle centroid
      lines.push([[x + s, y], g2], [[ax, ay], g2], [[x + (3 * s) / 2, y + h], g2]);
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Flowing dunes: horizontal contour rows whose amplitude, wavelength and phase drift by row via
// fixed sine mixes — deterministic, but reads organic. Amplitudes are bounded so adjacent rows
// (5 mm apart, ≤ ~1.8 mm total deviation each) can never touch.
function dunesBands(f: Bbox): Ring[] {
  const spacing = 5;
  const n = Math.floor((f.y1 - f.y0 - 2) / spacing) + 1;
  if (n < 2) return [];
  const yStart = (f.y0 + f.y1) / 2 - ((n - 1) * spacing) / 2;
  const lines: Ring[] = [];
  for (let i = 0; i < n; i++) {
    const yc = yStart + i * spacing;
    const amp = 0.85 + 0.45 * Math.sin(i * 0.9 + 0.6);
    const lam = 30 + 7 * Math.sin(i * 0.53 + 1.1);
    const phi = i * 0.62;
    const row: Ring = [];
    for (let x = f.x0 - 1; x < f.x1 + 1; x += 2) row.push([x, duneY(x, yc, amp, lam, phi)]);
    row.push([f.x1 + 1, duneY(f.x1 + 1, yc, amp, lam, phi)]);
    lines.push(row);
  }
  return strokeRings(lines, PATTERN_W);
}

function duneY(x: number, yc: number, amp: number, lam: number, phi: number): number {
  return (
    yc +
    amp * Math.sin((2 * Math.PI * x) / lam + phi) +
    0.35 * amp * Math.sin((2 * Math.PI * x) / (lam * 0.43) + 2.2 * phi)
  );
}

// Chevron parquet: stacked zigzag pinstripes with the peaks aligned in columns, the French
// parquet floor. Rows sit on absolute heights so framed and full show the same weave.
function chevronBands(f: Bbox): Ring[] {
  const period = 16;
  const amp = 4.5;
  const spacing = 5.2;
  const cx = (f.x0 + f.x1) / 2;
  const lines: Ring[] = [];
  const kMax = Math.ceil((f.x1 - f.x0) / period) + 2;
  const n0 = Math.floor((f.y0 - 2 - amp) / spacing);
  const n1 = Math.ceil((f.y1 + 2 + amp) / spacing);
  for (let n = n0; n <= n1; n++) {
    const row: Ring = [];
    for (let k = -kMax; k <= kMax; k++) {
      row.push([cx + (k * period) / 2, n * spacing + (k & 1 ? amp / 2 : -amp / 2)]);
    }
    lines.push(row);
  }
  return strokeRings(lines, PATTERN_W);
}

// Herringbone twill: columns of parallel ±45° ribs, adjacent columns mirrored and offset half a
// step — the broken-twill seam of woven cloth and parquet floors. The half-step matters: rib
// ends MEET the seam offset, never flush, which is exactly what reads as herringbone rather
// than a chevron drawn twice.
function herringboneBands(f: Bbox): Ring[] {
  const colW = 9; // column width = a rib's horizontal run
  const s = 4.6; // rib spacing, measured vertically
  const cx = (f.x0 + f.x1) / 2;
  const lines: Ring[] = [];
  const cMax = Math.ceil((f.x1 - f.x0) / (2 * colW)) + 1;
  for (let c = -cMax; c <= cMax; c++) {
    const xL = cx + c * colW;
    const up = ((c % 2) + 2) % 2 === 0;
    const off = up ? 0 : s / 2; // the twill break between mirrored columns
    const n0 = Math.floor((f.y0 - colW - 2) / s);
    const n1 = Math.ceil((f.y1 + colW + 2) / s);
    for (let n = n0; n <= n1; n++) {
      const y = n * s + off;
      lines.push([
        [xL, y],
        [xL + colW, y + (up ? colW : -colW)],
      ]);
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Yabane (arrow fletching): columns of nested feather chevrons between fine vertical rules,
// adjacent columns pointing opposite ways and half-stepped — the meisen-kimono classic. Two
// nested V strokes per feather leave a thin slit of bare wood at each feather's tail, the
// fletching's swallowtail notch.
function yabaneBands(f: Bbox): Ring[] {
  const colW = 11; // column width
  const p = 13; // feather period along the column
  const drop = 8.5; // V depth — steep vanes, not chevron zigzag
  const nest = 3.4; // spacing between a feather's two nested strokes
  const inset = 0.9; // vane air off the column rules
  const cx = (f.x0 + f.x1) / 2;
  const lines: Ring[] = [];
  const cMax = Math.ceil((f.x1 - f.x0) / (2 * colW)) + 1;
  for (let c = -cMax; c <= cMax; c++) {
    const x0 = cx + c * colW;
    const xm = x0 + colW / 2;
    const x1 = x0 + colW;
    const up = ((c % 2) + 2) % 2 === 1; // alternate columns fire the other way
    lines.push([
      [x0, f.y0 - 2],
      [x0, f.y1 + 2],
    ]);
    const n0 = Math.floor((f.y0 - 2 * p) / p);
    const n1 = Math.ceil((f.y1 + 2 * p) / p);
    for (let n = n0; n <= n1; n++) {
      const yb = n * p + (up ? p / 2 : 0); // opposed columns half-step, like real fletching rows
      for (const off of [0, nest]) {
        lines.push(
          up
            ? [
                [x0 + inset, yb - off - drop],
                [xm, yb - off],
                [x1 - inset, yb - off - drop],
              ]
            : [
                [x0 + inset, yb + off + drop],
                [xm, yb + off],
                [x1 - inset, yb + off + drop],
              ],
        );
      }
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Greek key (meander): running-fret bands, each ONE continuous line — up the unit's left, along
// the top, folded back into its hook, out along the baseline (U3 R3 D2 L2 D1 R3 on the unit
// grid) — bracketed by rail pinstripes like the classical border. Whole bands only: the row
// count is chosen to fit, so the fret is never truncated mid-hook vertically.
function meanderBands(f: Bbox): Ring[] {
  const g = 3.2; // unit grid; a unit is 4g wide, its hooks 3g tall
  const rail = 1.6; // air between the hooks and each rail
  const bandH = 3 * g + 2 * rail;
  const gap = 4.8; // plain wood between bands
  const n = Math.max(1, Math.floor((f.y1 - f.y0 - 2 + gap) / (bandH + gap)));
  const yFirst = (f.y0 + f.y1) / 2 - (n * (bandH + gap) - gap) / 2 + rail; // band 0 hook baseline
  const lines: Ring[] = [];
  const kMax = Math.ceil((f.x1 - f.x0) / (4 * g)) + 2;
  for (let r = 0; r < n; r++) {
    const y0 = yFirst + r * (bandH + gap);
    lines.push(
      [
        [f.x0 - 2, y0 - rail],
        [f.x1 + 2, y0 - rail],
      ],
      [
        [f.x0 - 2, y0 + 3 * g + rail],
        [f.x1 + 2, y0 + 3 * g + rail],
      ],
    );
    const row: Ring = [[f.x0 - 4 * g, y0]];
    let x = f.x0 - 4 * g;
    for (let k = 0; k <= kMax; k++) {
      row.push(
        [x, y0 + 3 * g],
        [x + 3 * g, y0 + 3 * g],
        [x + 3 * g, y0 + g],
        [x + g, y0 + g],
        [x + g, y0],
        [x + 4 * g, y0],
      );
      x += 4 * g;
    }
    lines.push(row);
  }
  return strokeRings(lines, PATTERN_W);
}

// Guilloché: engine turning's torsade — two antiphase sine strands per band crossing into a
// chain of lenses, alternate bands shifted a quarter wave so the lenses brick. The watchmaker's
// ornament: the one curve family here that deliberately reads machined-precise.
function guillocheBands(f: Bbox): Ring[] {
  const lam = 18; // wavelength; lenses read ~9 mm long
  const amp = 3.3;
  const pitch = 9.5; // band pitch — engine turning runs dense, bands nearly touching
  if (f.y1 - f.y0 < 2 * amp + 2) return [];
  const n = Math.max(1, Math.floor((f.y1 - f.y0 - 2 * amp - 1) / pitch) + 1);
  const yStart = (f.y0 + f.y1) / 2 - ((n - 1) * pitch) / 2;
  const cx = (f.x0 + f.x1) / 2;
  const lines: Ring[] = [];
  for (let r = 0; r < n; r++) {
    const yc = yStart + r * pitch;
    const phase = r % 2 === 1 ? Math.PI / 2 : 0; // brick the lenses band to band
    for (const sgn of [1, -1]) {
      const row: Ring = [];
      for (let x = f.x0 - 2; x <= f.x1 + 2; x += 0.7) {
        row.push([x, yc + sgn * amp * Math.sin((2 * Math.PI * (x - cx)) / lam + phase)]);
      }
      lines.push(row);
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Tatewaku (rising steam): vertical undulating lines with neighbours in antiphase, so each gap
// swells into a barrel then pinches to a waist, and adjacent gaps alternate — the Heian court
// textile classic, the calm smooth-curved counterpart to the ogee's cusps.
function tatewakuBands(f: Bbox): Ring[] {
  const p = 7.5; // line pitch
  const amp = 2.2; // swell: gaps breathe between p − 2·amp and p + 2·amp
  const lam = 30; // vertical wavelength
  const cx = (f.x0 + f.x1) / 2;
  const lines: Ring[] = [];
  const kMax = Math.ceil((f.x1 - f.x0) / (2 * p)) + 1;
  for (let k = -kMax; k <= kMax; k++) {
    const sgn = ((k % 2) + 2) % 2 === 0 ? 1 : -1;
    const row: Ring = [];
    for (let y = f.y0 - 2; y <= f.y1 + 2; y += 0.7) {
      row.push([cx + k * p + sgn * amp * Math.sin((2 * Math.PI * y) / lam), y]);
    }
    row.push([cx + k * p + sgn * amp * Math.sin((2 * Math.PI * (f.y1 + 2)) / lam), f.y1 + 2]);
    lines.push(row);
  }
  return strokeRings(lines, PATTERN_W);
}

// Hitomezashi (one-stitch sashiko): a single dash per grid cell, drawn or skipped by the parity
// of the cell index plus its row/column phase word — the pattern is EMERGENT, rising from how
// the phases interfere. The 0,0,1,1 word on both axes yields the classic persimmon-flower
// (kaki-no-hana) clusters. Dashes are also the cheapest thing a laser can engrave.
const HITOMEZASHI_WORD = [0, 0, 1, 1];

function hitomezashiBands(f: Bbox): Ring[] {
  const g = 3.4; // grid pitch = stitch length, true to cloth sashiko
  const w = HITOMEZASHI_WORD;
  const phase = (k: number) => w[((k % w.length) + w.length) % w.length]!;
  const even = (v: number) => ((v % 2) + 2) % 2 === 0;
  const lines: Ring[] = [];
  const i0 = Math.floor((f.x0 - 2) / g);
  const i1 = Math.ceil((f.x1 + 2) / g);
  const j0 = Math.floor((f.y0 - 2) / g);
  const j1 = Math.ceil((f.y1 + 2) / g);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (even(i + phase(j))) {
        lines.push([
          [i * g, j * g],
          [(i + 1) * g, j * g],
        ]);
      }
      if (even(j + phase(i))) {
        lines.push([
          [i * g, j * g],
          [i * g, (j + 1) * g],
        ]);
      }
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Basketweave: square cells of three short strokes, alternating warp and weft like a woven mat.
function basketweaveBands(f: Bbox): Ring[] {
  const g = 13;
  const inset = 1.1;
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  const lines: Ring[] = [];
  const iMax = Math.ceil((f.x1 - f.x0) / (2 * g)) + 1;
  const jMax = Math.ceil((f.y1 - f.y0) / (2 * g)) + 1;
  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      const x0 = cx + i * g;
      const y0 = cy + j * g;
      const horiz = (((i + j) % 2) + 2) % 2 === 0;
      for (let k = 1; k <= 3; k++) {
        const t = (g * k) / 4;
        lines.push(
          horiz
            ? [
                [x0 + inset, y0 + t],
                [x0 + g - inset, y0 + t],
              ]
            : [
                [x0 + t, y0 + inset],
                [x0 + t, y0 + g - inset],
              ],
        );
      }
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Ogee trellis: two mirrored sine families per column whose tangent crossings stack pointed
// lanterns — gothic tracery by way of the Moroccan trellis, echoing the lid frame's cusps.
function ogeeBands(f: Bbox): Ring[] {
  const g = 11; // column pitch; amp = g/2 makes neighbouring curves kiss at the junctions
  const lam = 24;
  const cx = (f.x0 + f.x1) / 2;
  const lines: Ring[] = [];
  const iMax = Math.ceil((f.x1 - f.x0) / (2 * g)) + 1;
  for (let i = -iMax; i <= iMax; i++) {
    for (const s of [1, -1]) {
      const row: Ring = [];
      for (let y = f.y0 - 2; y <= f.y1 + 2; y += 1.5) {
        row.push([cx + i * g + s * (g / 2) * Math.sin((2 * Math.PI * y) / lam), y]);
      }
      lines.push(row);
    }
  }
  return strokeRings(lines, PATTERN_W);
}

// Kikkō: the tortoiseshell hexagon lattice, flat-topped. Shared edges coincide exactly, and the
// stroke union merges the doubled lines into one band.
function kikkoBands(f: Bbox): Ring[] {
  const s = 7; // hex side
  const colP = 1.5 * s;
  const rowP = s * Math.sqrt(3);
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  const rings: Ring[] = [];
  const iMax = Math.ceil((f.x1 - f.x0) / (2 * colP)) + 1;
  const jMax = Math.ceil((f.y1 - f.y0) / (2 * rowP)) + 1;
  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      const hx = cx + i * colP;
      const hy = cy + j * rowP + (((i % 2) + 2) % 2 === 1 ? rowP / 2 : 0);
      const ring: Ring = [];
      for (let v = 0; v < 6; v++) {
        const a = (Math.PI / 3) * v;
        ring.push([hx + s * Math.cos(a), hy + s * Math.sin(a)]);
      }
      rings.push(ring);
    }
  }
  return strokeRings(rings, PATTERN_W, true);
}

// Shippō ("seven treasures"): interlocking circles on a square grid of pitch r√2, each circle
// overlapping its four neighbours into four-petal flowers between curved diamonds.
function shippoBands(f: Bbox): Ring[] {
  const r = 8;
  const p = r * Math.SQRT2;
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  const rings: Ring[] = [];
  const iMax = Math.ceil((f.x1 - f.x0) / (2 * p)) + 1;
  const jMax = Math.ceil((f.y1 - f.y0) / (2 * p)) + 1;
  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      rings.push(circleRing(cx + i * p, cy + j * p, r, 36));
    }
  }
  return strokeRings(rings, PATTERN_W, true);
}

// Star and cross (khatam): the classic Islamic tessellation, both voices drawn — eight-point
// stars (16-gon outline + inscribed waist octagon) on a square grid, and a Greek cross in every
// void between four stars, its arms reaching into the tip channels exactly where the
// tessellation's crosses sit. Tips deliberately do NOT touch: with tips meeting, the
// valley-to-tip edges of adjacent stars lie on the same ±45° lines and chain into field-long
// diagonals that read as a net, not stars. The ceramic originals separate the pieces with grout;
// the gap plays that role here.
function starcrossBands(f: Bbox): Ring[] {
  const R = 6.5; // star tip radius; the star spans 2R
  const P = 2 * R + 2.4; // grid pitch: tip-to-tip air is the linework's grout line
  const ca = 0.7 * R; // cross arm reach — into the channel mouth, clear of the four tips
  const cw = 0.23 * R; // cross arm half-width
  const rin = R * Math.hypot(1 - Math.SQRT1_2, Math.SQRT1_2); // valley radius: where the two
  // generator squares' edges cross (≈ 0.765 R), at 22.5° between the tips
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  const rings: Ring[] = [];
  const iMax = Math.ceil((f.x1 - f.x0) / (2 * P)) + 1;
  const jMax = Math.ceil((f.y1 - f.y0) / (2 * P)) + 1;
  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      const x = cx + i * P;
      const y = cy + j * P;
      const outline: Ring = [];
      const waist: Ring = [];
      for (let v = 0; v < 8; v++) {
        const a = (Math.PI / 4) * v;
        outline.push([x + R * Math.cos(a), y + R * Math.sin(a)]);
        outline.push([x + rin * Math.cos(a + Math.PI / 8), y + rin * Math.sin(a + Math.PI / 8)]);
        waist.push([x + rin * Math.cos(a + Math.PI / 8), y + rin * Math.sin(a + Math.PI / 8)]);
      }
      const vx = x + P / 2;
      const vy = y + P / 2;
      const cross: Ring = [
        [vx + ca, vy + cw],
        [vx + cw, vy + cw],
        [vx + cw, vy + ca],
        [vx - cw, vy + ca],
        [vx - cw, vy + cw],
        [vx - ca, vy + cw],
        [vx - ca, vy - cw],
        [vx - cw, vy - cw],
        [vx - cw, vy - ca],
        [vx + cw, vy - ca],
        [vx + cw, vy - cw],
        [vx + ca, vy - cw],
      ];
      rings.push(outline, waist, cross);
    }
  }
  return strokeRings(rings, PATTERN_W, true);
}

// --- kagome ------------------------------------------------------------------------------------
//
// The Japanese woven-bamboo lattice: three families of straight strands at 0°/60°/120°, the
// third family half-stepped so every crossing is PAIRWISE (hexagons and triangles — the
// trihexagonal lattice) instead of the triple points of a triangular grid. What sells it as
// basketry is the WEAVE: at every crossing one strand passes over and the other breaks, and
// along any strand the states strictly alternate — the tri-axial open weave of a real basket.
// The assignment is propagated crossing-to-crossing (a real kagome weave exists, so the
// propagation is globally consistent); the under strand then breaks with air on both sides.

const KAGOME_S = 8.5; // strand pitch within a family; hexagon eyes read ~ this size
const KAGOME_BREAK = 1.1; // under-strand break half-length at a crossing

type KagomeLine = {
  px: number; // a point on the line (the field centre's projection)
  py: number;
  dx: number; // unit direction
  dy: number;
  crossings: { t: number; c: number }[]; // sorted along the line
};

function kagomeBands(f: Bbox): Ring[] {
  const s = KAGOME_S;
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0) / 2 + 2 * s;

  const lines: KagomeLine[] = [];
  for (let fam = 0; fam < 3; fam++) {
    const th = (Math.PI / 3) * fam;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    const nx = -dy;
    const ny = dx;
    const shift = fam === 2 ? s / 2 : 0; // the half-step that keeps crossings pairwise
    const along = cx * dx + cy * dy;
    const n0 = Math.round((cx * nx + cy * ny - shift) / s);
    const nMax = Math.ceil(L / s);
    for (let n = n0 - nMax; n <= n0 + nMax; n++) {
      const d = n * s + shift;
      lines.push({ px: nx * d + dx * along, py: ny * d + dy * along, dx, dy, crossings: [] });
    }
  }

  // Pairwise crossings, closed form (same-family lines are parallel and skip on the epsilon).
  type Crossing = { a: number; b: number; aOver: boolean; set: boolean };
  const crossings: Crossing[] = [];
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const A = lines[a]!;
      const B = lines[b]!;
      const den = A.dx * B.dy - A.dy * B.dx;
      if (Math.abs(den) < 1e-9) continue;
      const wx = B.px - A.px;
      const wy = B.py - A.py;
      const ta = (wx * B.dy - wy * B.dx) / den;
      const tb = (wx * A.dy - wy * A.dx) / den;
      if (Math.abs(ta) > L || Math.abs(tb) > L) continue;
      const x = A.px + A.dx * ta;
      const y = A.py + A.dy * ta;
      if (x < f.x0 - s || x > f.x1 + s || y < f.y0 - s || y > f.y1 + s) continue;
      const c = crossings.length;
      crossings.push({ a, b, aOver: false, set: false });
      A.crossings.push({ t: ta, c });
      B.crossings.push({ t: tb, c });
    }
  }
  for (const line of lines) line.crossings.sort((u, v) => u.t - v.t);

  // Propagate the weave: seed a crossing, then walk every strand forcing neighbours opposite.
  const stateOf = (li: number, cr: Crossing) => (cr.a === li ? cr.aOver : !cr.aOver);
  const setState = (li: number, cr: Crossing, over: boolean): void => {
    cr.aOver = cr.a === li ? over : !over;
    cr.set = true;
  };
  const queue: number[] = [];
  for (let seed = 0; seed < crossings.length; seed++) {
    if (crossings[seed]!.set) continue;
    setState(crossings[seed]!.a, crossings[seed]!, true);
    queue.push(seed);
    while (queue.length > 0) {
      const ci = queue.pop()!;
      const cur = crossings[ci]!;
      for (const li of [cur.a, cur.b]) {
        const seq = lines[li]!.crossings;
        const at = seq.findIndex((e) => e.c === ci);
        const want = !stateOf(li, cur);
        for (const nb of [seq[at - 1], seq[at + 1]]) {
          if (!nb || crossings[nb.c]!.set) continue;
          setState(li, crossings[nb.c]!, want);
          queue.push(nb.c);
        }
      }
    }
  }

  // Emit each strand as runs broken at its under crossings (the over strand runs through).
  const out: Ring[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    let t0 = -L;
    const runs: [number, number][] = [];
    for (const e of line.crossings) {
      if (stateOf(li, crossings[e.c]!)) continue;
      runs.push([t0, e.t - KAGOME_BREAK]);
      t0 = e.t + KAGOME_BREAK;
    }
    runs.push([t0, L]);
    for (const [ta, tb] of runs) {
      if (tb - ta < 0.6) continue;
      out.push([
        [line.px + line.dx * ta, line.py + line.dy * ta],
        [line.px + line.dx * tb, line.py + line.dy * tb],
      ]);
    }
  }
  return strokeRings(out, PATTERN_W);
}

// --- the mana monogram -------------------------------------------------------------------------

const MANA_D = 7.5; // glyph Ø
const MANA_PX = 15; // column pitch
const MANA_PY = 11; // row pitch; alternate rows stagger half a column
const MANA_AIR = 0.5; // whole-glyph placement clearance beyond the glyph's own radius

// The identity tiled like a luxury monogram canvas: glyphs on a staggered grid centred in the
// field, cycling through the pips diagonally ((col + row) mod n). Whole glyphs only — one that
// would cross the field edge or the notch keep-out is dropped, not cropped.
function manaElement(
  cfg: LidArt,
  f: Bbox,
  notch: ThumbNotch | null,
  H: number,
  clear: number,
): LidArtElement | null {
  if (cfg.pips.length === 0) return null;
  const r = MANA_D / 2 + MANA_AIR;
  const cols = Math.floor((f.x1 - f.x0 - MANA_D) / MANA_PX) + 1;
  const rows = Math.floor((f.y1 - f.y0 - MANA_D) / MANA_PY) + 1;
  if (cols < 1 || rows < 1) return null;
  const gx0 = (f.x0 + f.x1) / 2 - ((cols - 1) * MANA_PX) / 2;
  const gy0 = (f.y0 + f.y1) / 2 - ((rows - 1) * MANA_PY) / 2;
  const paths: string[] = [];
  const bbox: Bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let j = 0; j < rows; j++) {
    const off = j % 2 === 1 ? MANA_PX / 2 : 0;
    for (let i = 0; i < cols; i++) {
      const x = gx0 + i * MANA_PX + off;
      const y = gy0 + j * MANA_PY;
      if (x - r < f.x0 || x + r > f.x1) continue; // staggered rows lose their overflow column
      if (notch && notchDist(notch, H, x, y) < clear + r) continue;
      const glyph = cfg.symbolPaths[cfg.pips[(i + j) % cfg.pips.length]!];
      if (!glyph) continue;
      const coin = healedCoin(glyph, MANA_D);
      if (coin.glyph.length === 0) continue;
      paths.push(ringsToPath(coin.glyph, x, y));
      bbox.x0 = Math.min(bbox.x0, x - MANA_D / 2);
      bbox.y0 = Math.min(bbox.y0, y - MANA_D / 2);
      bbox.x1 = Math.max(bbox.x1, x + MANA_D / 2);
      bbox.y1 = Math.max(bbox.y1, y + MANA_D / 2);
    }
  }
  if (paths.length === 0) return null;
  return { id: "pattern", pass: "engrave", paths, fillRule: "evenodd", bbox };
}

// --- the pattern field -------------------------------------------------------------------------

// A pattern field is a pure function of its cache key — (layout, style, crop geometry) —
// memoised so slider drags that leave a wall's geometry unchanged never re-run the Clipper crop;
// the region is a thunk so a cache hit skips even the region boolean. (mana bypasses this — its
// glyph stamping is cheap and depends on the symbol data, which healedCoin already caches.)
const fieldCache = new Map<string, LidArtElement | null>();

// Every bbox-tiling generator, keyed by style; seigaiha stays special-cased for its stamp split.
const GENERATORS: Record<Exclude<SideStyle, "none" | "mana" | "seigaiha">, (f: Bbox) => Ring[]> = {
  lattice: latticeBands,
  chevron: chevronBands,
  herringbone: herringboneBands,
  yabane: yabaneBands,
  basketweave: basketweaveBands,
  meander: meanderBands,
  sunburst: sunburstBands,
  ogee: ogeeBands,
  tatewaku: tatewakuBands,
  guilloche: guillocheBands,
  starcross: starcrossBands,
  asanoha: asanohaBands,
  kagome: kagomeBands,
  kikko: kikkoBands,
  shippo: shippoBands,
  hitomezashi: hitomezashiBands,
  dunes: dunesBands,
};

function patternElement(
  style: Exclude<SideStyle, "none" | "mana">,
  cover: Bbox, // the generators tile this bbox
  safe: Bbox, // seigaiha stamps wholly inside skip the crop — must be provably solid material
  kb: NotchBox | null,
  region: () => Ring[], // the crop region: the material the bands may occupy
  key: string,
): LidArtElement | null {
  const hit = fieldCache.get(key);
  if (hit !== undefined) return hit;

  let bands: Ring[];
  if (style === "seigaiha") {
    const { inside, boundary } = seigaihaScales(cover, safe, kb);
    bands = [...inside, ...dropFragments(clipRings("intersection", boundary, region()))];
  } else {
    bands = dropFragments(clipRings("intersection", GENERATORS[style](cover), region()));
  }
  const el: LidArtElement | null =
    bands.length === 0
      ? null
      : {
          id: "pattern",
          pass: "engrave",
          paths: [ringsToPath(bands, 0, 0)],
          fillRule: "evenodd",
          bbox: ringsBbox(bands),
        };
  if (fieldCache.size > 64) fieldCache.clear(); // tiny app: crude but sufficient bound
  fieldCache.set(key, el);
  return el;
}

// --- the layout --------------------------------------------------------------------------------

// One wall's composition. W×H is the panel blank; notch is that wall's thumb-notch spec in its
// OWN frame (the back wall's deepened depth already applied); outline is the panel's real cut
// silhouette in the same drawn frame (only the full layout crops against it).
function wallElements(
  cfg: LidArt,
  W: number,
  H: number,
  t: number,
  notch: ThumbNotch | null,
  outline: Ring,
): LidArtElement[] {
  if (cfg.sideLayout === "full") return fullWallElements(cfg, W, H, t, notch, outline);
  const els: LidArtElement[] = [];
  const M = wallMargin(t);
  const A = { x0: M, y0: M, x1: W - M, y1: H - M };
  if (A.x1 - A.x0 < MIN_FRAME || A.y1 - A.y0 < MIN_FRAME) return els;

  const border = pinstripe(
    "border",
    roundedRectRing(A.x0, A.y0, A.x1, A.y1, BORDER_R),
    BORDER_W,
    notch ? notchKeepout(notch, H, NOTCH_CLEAR) : null,
  );
  if (border) els.push(border);

  const inset = BORDER_W + FIELD_GAP;
  const f = { x0: A.x0 + inset, y0: A.y0 + inset, x1: A.x1 - inset, y1: A.y1 - inset };
  if (f.x1 - f.x0 < MIN_FIELD || f.y1 - f.y0 < MIN_FIELD) return els;
  const clear = NOTCH_CLEAR + inset; // the pattern's keep-out off the notch cut edge

  const pattern =
    cfg.sides === "mana"
      ? manaElement(cfg, f, notch, H, clear)
      : cfg.sides === "none"
        ? null
        : patternElement(
            cfg.sides,
            f,
            f,
            notch ? notchBox(notch, H, clear) : null,
            () => {
              const field = [roundedRectRing(f.x0, f.y0, f.x1, f.y1, 0)];
              return notch
                ? clipRings("difference", field, [notchKeepout(notch, H, clear)])
                : field;
            },
            [
              "framed",
              cfg.sides,
              f.x0.toFixed(3),
              f.y0.toFixed(3),
              f.x1.toFixed(3),
              f.y1.toFixed(3),
              notch
                ? `${notch.cx.toFixed(3)}|${notch.halfW}|${notch.depth.toFixed(3)}|${H.toFixed(3)}`
                : "-",
            ].join("|"),
          );
  if (pattern) els.push(pattern);
  return els;
}

// The full layout's memo key must fingerprint the crop geometry itself: the outline moves with
// params the blank size can't see (kerf, finger width, the notch shape). Same fixed(3) rounding
// as the framed key.
function outlineKey(outline: Ring): string {
  let s = "";
  for (const [x, y] of outline) s += `${x.toFixed(3)},${y.toFixed(3)};`;
  return s;
}

// The FULL layout: no border, no margins. Continuous patterns tile the whole blank and crop to
// the panel's cut outline, bleeding to every cut edge. Mana keeps its whole-glyph rule instead —
// a bled glyph would be a cropped glyph, which engraves as debris — so its grid grows to the
// joint-safe interior and keeps a token clearance off the thumb cut.
function fullWallElements(
  cfg: LidArt,
  W: number,
  H: number,
  t: number,
  notch: ThumbNotch | null,
  outline: Ring,
): LidArtElement[] {
  if (cfg.sides === "none" || W < MIN_FIELD || H < MIN_FIELD) return [];
  // 2t is the deepest joint recess on any wall (wallMargin's bound, sans the visual air): the
  // blank inset by it is guaranteed solid, so seigaiha stamps there skip the outline crop and
  // mana glyphs there can never straddle a comb cut.
  const safe = { x0: 2 * t, y0: 2 * t, x1: W - 2 * t, y1: H - 2 * t };
  if (cfg.sides === "mana") {
    if (safe.x1 - safe.x0 < MIN_FIELD || safe.y1 - safe.y0 < MIN_FIELD) return [];
    const el = manaElement(cfg, safe, notch, H, NOTCH_CLEAR);
    return el ? [el] : [];
  }
  const el = patternElement(
    cfg.sides,
    { x0: 0, y0: 0, x1: W, y1: H },
    safe,
    notch ? notchBox(notch, H, 0) : null,
    () => [outline],
    `full|${cfg.sides}|${outlineKey(outline)}`,
  );
  return el ? [el] : [];
}

// Produce the four walls' art. Empty when the style is "none". Gated on cfg.sides alone — the
// lid marque's `enabled` flag does not reach the walls, so a box can wear side engravings with a
// bare lid (or the reverse).
export function layoutSideArt(p: Params, cfg: LidArt): WallArt[] {
  if (cfg.sides === "none") return [];
  const d = dims(p);
  const t = p.thickness;

  // The real cut outlines, drawn frame — the full layout's crop regions (panels() pre-mirrors the
  // left outer, so every decorated outline is already in the view frame the art draws in). Pure
  // array math, cheap enough to just re-run here rather than thread through every caller.
  const outlineById = new Map(panels(p).map((pn) => [pn.id, pn.outline]));

  // The thumb-notch spec is lid-plane-relative (panels.ts): the front wall takes it as-is, the
  // back wall's cut deepens by the walls' height difference. Same conversion as panels().
  const notch = thumbNotch(p);
  const frontNotch = notch && p.notchWalls !== "back" ? notch : null;
  const backNotch =
    notch && p.notchWalls !== "front"
      ? { ...notch, depth: notch.depth + (d.wallH - d.slotZ) }
      : null;

  const walls: {
    id: WallId;
    face: "top" | "bottom";
    W: number;
    H: number;
    n: ThumbNotch | null;
  }[] = [
    { id: "body-front", face: "top", W: d.outerW, H: d.slotZ, n: frontNotch },
    { id: "side-right-outer", face: "top", W: d.outerD, H: d.wallH, n: null },
    { id: "body-back", face: "bottom", W: d.outerW, H: d.wallH, n: backNotch },
    { id: "side-left-outer", face: "top", W: d.outerD, H: d.wallH, n: null },
  ];
  return walls
    .map((wall) => ({
      panelId: wall.id,
      artFace: wall.face,
      w: wall.W,
      h: wall.H,
      elements: wallElements(cfg, wall.W, wall.H, t, wall.n, outlineById.get(wall.id)!),
    }))
    .filter((wa) => wa.elements.length > 0);
}
