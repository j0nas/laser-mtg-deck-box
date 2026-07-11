// Lid foil marque ("commander marque"): the parametric layout engine for the ALL-VECTOR foil
// composition on the deck-box lid. PURE and DOM-free — the same element list drives the SVG export
// (svg.ts), the 3D preview overlay (main.ts) and the tests. All geometry is in LID-LOCAL
// millimetres, y UP, origin at the lid blank's min corner — exactly the frame of the lid panel's
// `outline`, so the export can flip and place it with the panel it belongs to.
//
// ---------------------------------------------------------------------------------------------
// COMPOSITION (front edge y = 0 at the bottom; the pull hole sits near it)
// ---------------------------------------------------------------------------------------------
//   • Legendary CROWN ornament across the top.
//   • The commander NAME split at its first comma: the primary name set large (target ~10 mm,
//     auto-shrunk to the visible width) and ARCHED — the glyphs ride a shallow circular arc
//     (sagitta ~11 % of the set width), badge-style — with the epithet straight at ~45 % of it
//     beneath; thin STRAIGHT rules bracket the name block (only the text itself curves, the top
//     rule clearing the arch's apex). No comma → one auto-sized line. The comma itself is stripped.
//     On cramped lids (the shrink rungs of the ladder) the arch flattens back to a straight line.
//   • MANA ORBIT: the colour-identity symbols as foil coins in WUBRG order — a gold disc with the
//     REAL Scryfall glyph knocked out (glyph = bare wood against gold) — on an arc around/above
//     the pull hole, or, when the lid has no pull hole, a straight row centred in the band
//     between the name block and the content bottom.
//     Knocked-out detail is the robust polarity for foil (an unbonded sliver inside a
//     bonded field peels with the carrier sheet; tiny bonded islands lift), and manufacturability
//     at ANY size is guaranteed by vector morphological healing (heal.ts): sub-floor glyph detail
//     is minimally thickened, sub-floor foil slivers absorbed. Coins are sized adaptively —
//     ~14 mm Ø for 1–3 colour identities down to ~9 mm for 5 — or, with uniformPips, pinned to
//     the 5-colour size for every count so marques read consistent across a shelf of boxes; under
//     space pressure they shrink (healing absorbing the detail) down to 6 mm before the orbit
//     drops.
//     In MULTI pass mode the coin is instead a SOLID gold disc plus the glyph on the dark-engrave
//     layer inside it: engrave the glyph first, then the foil pass bonds the disc around the
//     charred recess — a gold coin with a dark glyph, the closest match to the printed symbol.
//   • Double-pinstripe BORDER around the visible zone — only when the lid FRAME is off: with the
//     frame on, its charred window edge IS the border (the pinstripe made physical), and the whole
//     composition confines itself to the window instead of the bare lid face.
//   • With the frame on, a FRAME TRACE instead: a thin foil band hugging the window silhouette
//     (arch, cusps, scallop and all) from just inside. Functionally it is the GLUE-PEEL GUIDE —
//     after the foil pass, peel the patch away outside the trace and the frame ring laminates
//     wood-on-wood — and visually it reads as a gold pinstripe echoing the frame edge. Its outer
//     boundary IS the window cut (same capWindowHole() points), so it registers exactly.
//
// Degradation on small lids: the orbit SHRINKS to its 6 mm floor first, then drops; then the
// epithet drops, then the primary name shrinks, then the crown drops. Nothing ever overlaps,
// everything keeps HOLE_CLEAR (1.5 mm) off the pull cut, and no foil feature is thinner than
// MIN_FOIL (0.4 mm).
//
// PASSES vs. WORKFLOW MODES: elements are tagged "foilGold" or "engrave". In "single" mode
// (default) everything lands on the ONE foil layer (blue #0000ff) — adhere a foil patch, run one
// job, peel once; the foil colour is a physical choice at the machine (single mode emits no engrave
// elements). In "multi" mode the coin glyphs split onto the dark-engrave layer (#000000) while the
// foil stays on #0000ff — engrave the recessed glyph first, then bond the disc around it. LightBurn
// ignores stroke-width and <text>, so every element is a CLOSED, FILLED region; the name is
// converted to glyph outlines via opentype.js.

import { healCoin, type HealedCoin, offsetRings, type Ring } from "./heal.ts";
import { capSpec, capWindowHole, pullHole } from "./panels.ts";
import { dims, type Params } from "./params.ts";

// Types from opentype.js — imported as TYPES only, so this module stays runtime-pure (no opentype
// import, no fs, no DOM). The caller (browser or Node test) parses the font and passes it.
import type { Font, PathCommand } from "opentype.js";

export type LidArtPass = "foilGold" | "engrave";
export type PassMode = "single" | "multi";

// The persisted, serialisable marque config (its own localStorage blob in main.ts). The Scryfall
// symbol glyphs are part of the EXPORTED geometry, so they persist here too — a reload must not
// lose the marque the user saw.
export type LidArt = {
  enabled: boolean;
  name: string;
  pips: string[]; // colour-identity symbol codes, e.g. ["W", "U", "B", "G"]
  symbolPaths: Record<string, string>; // symbol code -> raw glyph path d (Scryfall 0..100 viewBox)
  passMode: PassMode;
  uniformPips: boolean; // every identity count uses the 5-colour coin size (consistent across decks)
};

export type Bbox = { x0: number; y0: number; x1: number; y1: number };

export type LidArtElement = {
  id: string;
  pass: LidArtPass;
  paths: string[]; // SVG path-data strings, lid-local mm (y up), closed filled regions
  fillRule: "evenodd" | "nonzero";
  bbox: Bbox;
};

// Runtime assets the layout consumes but never persists.
export type LidArtAssets = {
  font?: Font | null; // no font -> name glyphs omitted (rules still render)
};

export const MIN_FOIL = 0.4; // minimum foil stroke / feature width (mm)
export const HOLE_CLEAR = 1.5; // keep every element this far off the pull cut
export const FRAME_TRACE_BAND = 0.5; // width of the frame's glue-peel trace band (mm)

export const PIP_MAX_D = 14; // coin Ø for 1–3 colour identities (mm)
export const PIP_UNIFORM_D = 9; // the 5-colour size — uniformPips pins EVERY count to it
export const PIP_MIN_D = 6; // coins shrink to this floor before the orbit drops
const PIP_GAP = 0.8; // clearance between adjacent coins and off the pull-hole keep-out
const PIP_SHRINK_STEP = 0.5;

const SYMBOL_CODES = ["W", "U", "B", "R", "G", "C"] as const; // canonical WUBRG(C) display order

// Scryfall's color_identity array is NOT order-guaranteed, so every ingestion point sorts into
// canonical WUBRG(C) order — pip 0 renders leftmost, so the sorted array reads correctly.
export function sortPips(codes: string[]): string[] {
  const order = SYMBOL_CODES as readonly string[];
  return [...codes].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export const DEFAULT_LID_ART: LidArt = {
  enabled: false,
  name: "",
  pips: [],
  symbolPaths: {},
  passMode: "single",
  uniformPips: false,
};

// Rebuild a clean LidArt from an untrusted storage blob — same strictness as the kit's sanitize:
// non-object root → defaults; unknown keys (including artBand/artDataUrl/artSrcUrl from older
// blobs) dropped; values taken only when their type matches; pips and symbolPaths pinned to the
// [WUBRGC] symbol alphabet.
export function sanitizeLidArt(raw: unknown): LidArt {
  const d = DEFAULT_LID_ART;
  if (typeof raw !== "object" || raw === null) return { ...d, pips: [], symbolPaths: {} };
  const o = raw as Record<string, unknown>;
  const pips = Array.isArray(o.pips)
    ? sortPips(
        o.pips
          .filter((x): x is string => typeof x === "string" && SYMBOL_CODES.includes(x as never))
          .slice(0, 6),
      )
    : [];
  const symbolPaths: Record<string, string> = {};
  if (typeof o.symbolPaths === "object" && o.symbolPaths !== null) {
    for (const code of SYMBOL_CODES) {
      const v = (o.symbolPaths as Record<string, unknown>)[code];
      if (typeof v === "string" && v.length > 0 && v.length < 20000) symbolPaths[code] = v;
    }
  }
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled,
    name: (typeof o.name === "string" ? o.name : d.name).slice(0, 60),
    pips,
    symbolPaths,
    passMode: o.passMode === "multi" ? "multi" : "single",
    uniformPips: typeof o.uniformPips === "boolean" ? o.uniformPips : d.uniformPips,
  };
}

// Split "Atraxa, Praetors' Voice" into the big line and the small line. The comma is stripped; no
// comma (or nothing after it) → single line.
export function splitName(name: string): { primary: string; epithet: string | null } {
  const i = name.indexOf(",");
  if (i < 0) return { primary: name.trim(), epithet: null };
  const epithet = name.slice(i + 1).trim();
  return { primary: name.slice(0, i).trim(), epithet: epithet.length > 0 ? epithet : null };
}

// Base coin diameter by colour-identity count: mono/duo/trio get the big 14 mm coins, four-colour
// 11.5 mm, five-colour (and the degenerate 6) 9 mm. With uniformPips every count is pinned to the
// 5-colour size, so a mono marque reads consistent next to a 5C one across a shelf of boxes.
export function pipBaseD(n: number, uniform = false): number {
  if (uniform) return PIP_UNIFORM_D;
  if (n <= 3) return PIP_MAX_D;
  if (n === 4) return 11.5;
  return 9;
}

// --- the visible zone -----------------------------------------------------------------------
//
// With the lid FRAME on, the marque lives in the frame's window: the window rect mapped into
// lid-local coordinates (the frame is centred on the lid, front edges flush) and inset by a
// margin so no foil ever slips under the frame's overhang, glue-jig tolerance included. The
// window's corner CUSPS bulge cusp-radius into the window from each square corner, so the margin
// grows to cusp/√2 — exactly the inset that keeps the zone's rect corners outside the cusps'
// quarter discs. The scallop and crown arch only ever REMOVE frame material outside this box, so
// they need no keep-out of their own.
//
// Without the frame, the lid rides one groove-depth into each side wall, so `hidden` mm at each x
// edge is buried and never seen; along y the whole lid face shows. We inset a small foil-safety
// margin off the front and back cut edges. Either way this is the box the whole marque is
// confined to (asserted by the tests).
const CAP_ART_MARGIN = 0.8;

export function visibleZone(p: Params): Bbox {
  const d = dims(p);
  const cap = capSpec(p);
  if (cap) {
    const xoff = (d.lidW - cap.w) / 2;
    const m = Math.max(CAP_ART_MARGIN, cap.cusp * Math.SQRT1_2 + 0.05);
    return {
      x0: xoff + cap.window.x0 + m,
      y0: cap.window.y0 + m,
      x1: xoff + cap.window.x1 - m,
      y1: cap.window.y1 - m,
    };
  }
  const hidden = (d.lidW - d.innerW) / 2; // groove depth per side (x only)
  const yEdge = 1.5;
  return { x0: hidden, y0: yEdge, x1: d.lidW - hidden, y1: d.lidL - yEdge };
}

// --- numeric formatting + path builders -----------------------------------------------------

function nfmt(v: number): string {
  return String(Math.round(v * 1e4) / 1e4);
}

function rectPath(x0: number, y0: number, x1: number, y1: number): string {
  return `M${nfmt(x0)} ${nfmt(y0)}L${nfmt(x1)} ${nfmt(y0)}L${nfmt(x1)} ${nfmt(y1)}L${nfmt(x0)} ${nfmt(y1)}Z`;
}

function roundRectPath(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (rr <= 1e-6) return rectPath(x0, y0, x1, y1);
  const a = (rx: number, ry: number) => `A${nfmt(rr)} ${nfmt(rr)} 0 0 1 ${nfmt(rx)} ${nfmt(ry)}`;
  return (
    `M${nfmt(x0 + rr)} ${nfmt(y0)}` +
    `L${nfmt(x1 - rr)} ${nfmt(y0)}${a(x1, y0 + rr)}` +
    `L${nfmt(x1)} ${nfmt(y1 - rr)}${a(x1 - rr, y1)}` +
    `L${nfmt(x0 + rr)} ${nfmt(y1)}${a(x0, y1 - rr)}` +
    `L${nfmt(x0)} ${nfmt(y0 + rr)}${a(x0 + rr, y0)}Z`
  );
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return (
    `M${nfmt(cx - rx)} ${nfmt(cy)}` +
    `A${nfmt(rx)} ${nfmt(ry)} 0 0 1 ${nfmt(cx + rx)} ${nfmt(cy)}` +
    `A${nfmt(rx)} ${nfmt(ry)} 0 0 1 ${nfmt(cx - rx)} ${nfmt(cy)}Z`
  );
}

function discPath(cx: number, cy: number, r: number): string {
  return ellipsePath(cx, cy, r, r);
}

function polyPath(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${nfmt(x)} ${nfmt(y)}`).join("") + "Z";
}

// Healed-coin rings (coin-local mm) -> one path-data string translated to (dx, dy).
function ringsToPath(rings: Ring[], dx: number, dy: number): string {
  return rings
    .map(
      (ring) =>
        ring.map(([x, y], i) => `${i === 0 ? "M" : "L"}${nfmt(dx + x)} ${nfmt(dy + y)}`).join("") +
        "Z",
    )
    .join("");
}

// --- opentype path -> lid-local y-up path-data ----------------------------------------------
//
// opentype's getPath yields commands in font space: x right, y DOWN, baseline at the y we pass.
// `tx` maps a font-space point to lid-local (y up); we walk M/L/C/Q/Z emitting a path-data string.
type Tx = (x: number, y: number) => [number, number];

function commandsToPath(commands: PathCommand[], tx: Tx): string {
  let d = "";
  for (const c of commands) {
    if (c.type === "M" || c.type === "L") {
      const [x, y] = tx(c.x, c.y);
      d += `${c.type}${nfmt(x)} ${nfmt(y)}`;
    } else if (c.type === "C") {
      const [x1, y1] = tx(c.x1, c.y1);
      const [x2, y2] = tx(c.x2, c.y2);
      const [x, y] = tx(c.x, c.y);
      d += `C${nfmt(x1)} ${nfmt(y1)} ${nfmt(x2)} ${nfmt(y2)} ${nfmt(x)} ${nfmt(y)}`;
    } else if (c.type === "Q") {
      const [x1, y1] = tx(c.x1, c.y1);
      const [x, y] = tx(c.x, c.y);
      d += `Q${nfmt(x1)} ${nfmt(y1)} ${nfmt(x)} ${nfmt(y)}`;
    } else if (c.type === "Z") {
      d += "Z";
    }
  }
  return d;
}

// --- the crown ornament ---------------------------------------------------------------------
//
// A Dominaria-flavoured legendary flourish: a central gem, two mirrored ribbon sweeps and two end
// dots, scaled to (w, h) and centred on cx, sitting on baseY..baseY+h. The dots overlap the ribbon
// ends and the whole ornament renders as ONE nonzero path, so every subpath must wind the same way
// (CCW in lid-local y-up, like discPath) — an opposite-wound overlap cancels to winding 0 and
// punches a hole instead of joining.
function crownPaths(cx: number, baseY: number, w: number, h: number): string[] {
  const gemW = h * 0.3;
  const gem = polyPath([
    [cx, baseY + h],
    [cx - gemW, baseY + 0.6 * h],
    [cx, baseY + 0.18 * h],
    [cx + gemW, baseY + 0.6 * h],
  ]);
  const rt = Math.max(MIN_FOIL, h * 0.16); // ribbon thickness
  const ribbon = (dir: 1 | -1): string => {
    const p0x = cx + dir * 0.1 * w;
    const p0y = baseY + 0.58 * h;
    const pcx = cx + dir * 0.3 * w;
    const pcy = baseY + 0.74 * h;
    const p1x = cx + dir * 0.47 * w;
    const p1y = baseY + 0.32 * h;
    // Mirroring (dir = -1) reverses orientation, so traverse the boundary in a dir-dependent
    // order that always comes out CCW.
    const top = `Q${nfmt(pcx)} ${nfmt(pcy)} `;
    const bot = `Q${nfmt(pcx)} ${nfmt(pcy - rt)} `;
    return dir === 1
      ? `M${nfmt(p0x)} ${nfmt(p0y - rt)}${bot}${nfmt(p1x)} ${nfmt(p1y - rt)}` +
          `L${nfmt(p1x)} ${nfmt(p1y)}${top}${nfmt(p0x)} ${nfmt(p0y)}Z`
      : `M${nfmt(p0x)} ${nfmt(p0y)}${top}${nfmt(p1x)} ${nfmt(p1y)}` +
          `L${nfmt(p1x)} ${nfmt(p1y - rt)}${bot}${nfmt(p0x)} ${nfmt(p0y - rt)}Z`;
  };
  const dot = (dir: 1 | -1) =>
    discPath(cx + dir * 0.47 * w, baseY + 0.32 * h, Math.max(MIN_FOIL / 2, h * 0.1));
  return [gem, ribbon(1), ribbon(-1), dot(1), dot(-1)];
}

// --- concentric-ring / pinstripe helpers ----------------------------------------------------

function roundRing(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  band: number,
): string[] {
  return [
    roundRectPath(x0, y0, x1, y1, r),
    roundRectPath(x0 + band, y0 + band, x1 - band, y1 - band, Math.max(0, r - band)),
  ];
}

// --- healed-coin cache -----------------------------------------------------------------------
//
// healCoin is deterministic but costs a few ms per symbol × size; the layout runs on every slider
// move, so memoise by (glyph, size). Keyed on the glyph string itself so a re-fetched symbol with
// different path data can never serve a stale coin.
const coinCache = new Map<string, HealedCoin>();

function healedCoin(glyphD: string, sizeMm: number): HealedCoin {
  const key = `${sizeMm.toFixed(2)}|${glyphD}`;
  const hit = coinCache.get(key);
  if (hit) return hit;
  const coin = healCoin(glyphD, sizeMm, MIN_FOIL);
  if (coinCache.size > 200) coinCache.clear(); // tiny app: crude but sufficient bound
  coinCache.set(key, coin);
  return coin;
}

// --- the layout engine ----------------------------------------------------------------------

const CROWN_MIN_H = 5;
const CROWN_MAX_H = 10;
const PRIMARY_H_MAX = 10; // target cap height of the big name line
const PRIMARY_H_MIN = 3.5; // below this the crown is dropped before shrinking further
const PRIMARY_H_HARD_MIN = 3; // absolute floor for a name-only marque
const EPITHET_RATIO = 0.45;
const EPITHET_H_MIN = 2.2; // an epithet smaller than this is dropped instead
const EGAP = 1.4; // primary ↔ epithet spacing
const GAP = 2;
const RULE_MARGIN = 2.2; // rules sit this far outside the name block (air gap = this − rule weight)
const ARC_RISE_RATIO = 0.11; // arch sagitta as a fraction of the primary's set width
const ARC_RISE_MAX = 0.5; // ...capped against the glyph-band height
const ARC_RISE_MIN = 0.3; // an arch shallower than this reads as a wobble — set straight instead

// --- the name arch ----------------------------------------------------------------------------
//
// The primary name rides a shallow circular arc: each glyph point maps (arc-length, height) →
// (angle, radius) on a circle whose radius comes from the classic chord/sagitta relation. The warp
// is applied per PATH POINT (control points included), which both tilts each glyph radially and
// lets serifs follow the curve; per-glyph angular spans are a few degrees, so the Bézier error is
// far below MIN_FOIL. Null → set the line straight (no font, empty text, or an arch so shallow it
// would read as a wobble).
type ArcName = {
  s: number; // font units → mm
  rise: number; // exact apex lift of the arc (mm) — the extra height the block consumes
  rBase: number; // circle radius at the glyph-band BOTTOM
  bandH: number; // glyph band height (mm) — ≤ the cap height for width-limited names
  phi: number; // half angular span of the text (arc-length parametrisation)
  gb: { x1: number; y1: number; x2: number; y2: number };
  commands: PathCommand[];
};

function planArcName(
  font: Font | null | undefined,
  text: string,
  capH: number,
  availW: number,
): ArcName | null {
  const t = text.trim().toUpperCase();
  if (!font || t.length === 0) return null;
  const path = font.getPath(t, 0, 0, 100);
  const gb = path.getBoundingBox();
  const gw = gb.x2 - gb.x1;
  const gh = gb.y2 - gb.y1;
  if (gw <= 0 || gh <= 0) return null;
  const maxW = availW * 0.94;
  // Arching swings the top corners outwards (they sit at rBase + bandH), so the set width that
  // fits maxW is found in two passes: size for the chord, then shrink by the measured overhang.
  const geom = (s: number) => {
    const W = gw * s;
    const bandH = gh * s;
    const target = Math.min(ARC_RISE_RATIO * W, ARC_RISE_MAX * bandH);
    if (target < 1e-6) return null;
    const rBase = (W * W) / (8 * target) + target / 2;
    const phi = W / (2 * rBase); // arc-length half-angle (the glyph map is arc-length true)
    return {
      bandH,
      rBase,
      phi,
      rise: rBase * (1 - Math.cos(phi)),
      outerW: 2 * (rBase + bandH) * Math.sin(phi),
    };
  };
  let s = Math.min(capH / gh, maxW / gw);
  let g = geom(s);
  if (!g || g.rise < ARC_RISE_MIN) return null;
  if (g.outerW > maxW) {
    s *= maxW / g.outerW;
    g = geom(s);
    if (!g || g.rise < ARC_RISE_MIN) return null;
  }
  return {
    s,
    rise: g.rise,
    rBase: g.rBase,
    bandH: g.bandH,
    phi: g.phi,
    gb,
    commands: path.commands,
  };
}

// Height the primary line wants: the target cap height, shrunk so the text still fits availW.
function primaryFitH(font: Font | null | undefined, text: string, availW: number): number {
  if (!font || text.length === 0) return PRIMARY_H_MAX;
  const path = font.getPath(text.toUpperCase(), 0, 0, 100);
  const gb = path.getBoundingBox();
  const gw = gb.x2 - gb.x1;
  const gh = gb.y2 - gb.y1;
  if (gw <= 0 || gh <= 0) return PRIMARY_H_MAX;
  return Math.min(PRIMARY_H_MAX, availW * 0.94 * (gh / gw));
}

// Produce the marque as a list of pass-tagged, lid-local elements. Empty when disabled or when the
// lid is too small to host anything without overlapping the pull hole.
export function layoutLidArt(p: Params, cfg: LidArt, assets: LidArtAssets = {}): LidArtElement[] {
  if (!cfg.enabled) return [];
  const vz = visibleZone(p);
  const hole = pullHole(p);
  const els: LidArtElement[] = [];

  const keep = hole ? { cx: hole.cx, cy: hole.cy, r: hole.r + HOLE_CLEAR } : null;

  // The pull-hole keep-out: vector content must clear its top, and the mana orbit circles just
  // outside its radius.
  const holeTop = keep ? keep.cy + keep.r : vz.y0;
  const holeRadius = keep ? keep.r : 0;

  // --- border frame (double pinstripe) around the visible zone -------------------------------
  //
  // Skipped entirely when the lid FRAME is on: its charred window edge replaces the pinstripes
  // (a foil border inside the physical one would just double-frame the marque), and the window
  // zone is already tight enough that the inset would cost real composition height.
  const cap = capSpec(p);
  const framed = cap != null;
  const fm = 1; // margin off the visible-zone edge
  const bo = { x0: vz.x0 + fm, y0: vz.y0 + fm, x1: vz.x1 - fm, y1: vz.y1 - fm };
  const bandA = 0.6;
  const gap2 = 1.1;
  const bandB = 0.5;
  const frameInset = bandA + gap2 + bandB;
  const fi = {
    x0: bo.x0 + frameInset,
    y0: bo.y0 + frameInset,
    x1: bo.x1 - frameInset,
    y1: bo.y1 - frameInset,
  };
  const frameFits =
    !framed &&
    fi.x1 - fi.x0 > 10 &&
    fi.y1 - fi.y0 > 10 &&
    (!keep ||
      (keep.cx - keep.r >= fi.x0 &&
        keep.cx + keep.r <= fi.x1 &&
        keep.cy - keep.r >= fi.y0 &&
        keep.cy + keep.r <= fi.y1));
  let inner = { x0: vz.x0, y0: vz.y0, x1: vz.x1, y1: vz.y1 };
  if (frameFits) {
    els.push({
      id: "border",
      pass: "foilGold",
      paths: [
        ...roundRing(bo.x0, bo.y0, bo.x1, bo.y1, 3, bandA),
        ...roundRing(
          bo.x0 + bandA + gap2,
          bo.y0 + bandA + gap2,
          bo.x1 - bandA - gap2,
          bo.y1 - bandA - gap2,
          2,
          bandB,
        ),
      ],
      fillRule: "evenodd",
      bbox: { ...bo },
    });
    inner = { ...fi };
  }

  // --- frame trace: the glue-peel guide -------------------------------------------------------
  //
  // The lid frame's window silhouette (the very capWindowHole() points the frame is cut with,
  // mapped cap → lid) as a thin foil band hugging the window edge from inside. Peel the foil
  // patch away OUTSIDE it and the frame ring glues wood-on-wood; what remains inside reads as a
  // gold pinstripe tracing the arch, cusps and scallop. It deliberately lives in the margin
  // between the window cut and the marque zone, so it is the one element allowed outside vz.
  if (cap) {
    const xoff = (dims(p).lidW - cap.w) / 2;
    const outer: Ring = capWindowHole(cap).map(([x, y]) => [x + xoff, y]);
    const band = offsetRings([outer], -FRAME_TRACE_BAND);
    if (band.length > 0) {
      const xs = outer.map((q) => q[0]);
      const ys = outer.map((q) => q[1]);
      els.push({
        id: "frame-trace",
        pass: "foilGold",
        paths: [polyPath(outer), ...band.map((r) => polyPath(r))],
        fillRule: "evenodd",
        bbox: {
          x0: Math.min(...xs),
          y0: Math.min(...ys),
          x1: Math.max(...xs),
          y1: Math.max(...ys),
        },
      });
    }
  }

  // --- content frame ---------------------------------------------------------------------------
  const pad = 1;
  const cx = (inner.x0 + inner.x1) / 2;
  const availW = inner.x1 - inner.x0 - 2 * pad;
  const contentTop = inner.y1 - pad;
  const contentBottom = Math.max(inner.y0 + pad, holeTop);

  // --- mana orbit at a given coin size --------------------------------------------------------
  //
  // Coins on an arc centred on the pull hole, just outside the hole keep-out, symmetric about
  // 12 o'clock. Adjacent coins keep PIP_GAP of air (chord = pipD + PIP_GAP); a spread past a
  // half-circle would wrap below the hole's equator, so that size is rejected. With no pull hole
  // the coins fall back to a straight row, planned at the content bottom and vertically centred
  // under the name block once its true bottom is known (see the render step).
  type Orbit = { positions: { x: number; y: number }[]; top: number; pipD: number };
  const nPips = cfg.pips.length;
  const orbitAt = (pipD: number): Orbit | null => {
    if (nPips === 0) return null;
    const pipR = pipD / 2;
    if (!hole) {
      const rowW = nPips * pipD + (nPips - 1) * PIP_GAP;
      if (rowW > availW) return null;
      const y = contentBottom + pipR;
      const x0 = cx - rowW / 2 + pipR;
      const positions = cfg.pips.map((_, i) => ({ x: x0 + i * (pipD + PIP_GAP), y }));
      return { positions, top: y + pipR, pipD };
    }
    const R = holeRadius + PIP_GAP + pipR;
    const step = nPips > 1 ? 2 * Math.asin(Math.min(1, (pipD + PIP_GAP) / (2 * R))) : 0;
    const spread = step * (nPips - 1);
    if (spread > Math.PI + 1e-9) return null;
    const start = Math.PI / 2 + spread / 2;
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < nPips; i++) {
      const th = start - i * step;
      positions.push({ x: hole.cx + R * Math.cos(th), y: hole.cy + R * Math.sin(th) });
    }
    const ok = positions.every(
      (q) =>
        q.x - pipR >= inner.x0 &&
        q.x + pipR <= inner.x1 &&
        q.y - pipR >= vz.y0 &&
        q.y + pipR <= inner.y1,
    );
    if (!ok) return null;
    return { positions, top: Math.max(...positions.map((q) => q.y + pipR)), pipD };
  };

  // --- degradation ladder ----------------------------------------------------------------------
  //
  // 1. full composition, coins shrinking from their base size down to PIP_MIN_D;
  // 2. drop the orbit; 3. drop the epithet; 4. flatten the arch and shrink the primary;
  // 5. drop the crown.
  const { primary, epithet } = splitName(cfg.name);
  const crownH = Math.min(CROWN_MAX_H, Math.max(CROWN_MIN_H, 0.14 * availW));
  const primaryTargetH = primaryFitH(assets.font, primary, availW);
  const wantEpithet = epithet != null && EPITHET_RATIO * primaryTargetH >= EPITHET_H_MIN;
  // The arch is planned at the TARGET height only: every rung that keeps primaryTargetH keeps the
  // arch (its rise counted in the block height); the shrink rungs set the line straight instead.
  const arc = planArcName(assets.font, primary, primaryTargetH, availW);

  type Plan = {
    crown: boolean;
    epithet: boolean;
    primaryH: number;
    arc: ArcName | null;
    orbit: Orbit | null;
  };
  const planHeight = (pl: Omit<Plan, "orbit">): number =>
    (pl.crown ? crownH + GAP : 0) +
    2 * RULE_MARGIN +
    pl.primaryH +
    (pl.arc ? pl.arc.rise : 0) +
    (pl.epithet ? EGAP + EPITHET_RATIO * pl.primaryH : 0);
  const floorOf = (orbit: Orbit | null): number =>
    orbit ? Math.max(orbit.top + GAP, contentBottom) : contentBottom;

  let plan: Plan | null = null;
  if (availW > 12) {
    const full = { crown: true, epithet: wantEpithet, primaryH: primaryTargetH, arc };
    const baseD = pipBaseD(nPips, cfg.uniformPips);
    for (let pipD = baseD; pipD >= PIP_MIN_D - 1e-9; pipD -= PIP_SHRINK_STEP) {
      const orbit = orbitAt(pipD);
      if (!orbit) continue;
      if (planHeight(full) <= contentTop - floorOf(orbit)) {
        plan = { ...full, orbit };
        break;
      }
    }
    if (!plan && planHeight(full) <= contentTop - contentBottom) {
      plan = { ...full, orbit: null };
    }
    if (!plan) {
      const noEp = { crown: true, epithet: false, primaryH: primaryTargetH, arc };
      if (planHeight(noEp) <= contentTop - contentBottom) plan = { ...noEp, orbit: null };
    }
    if (!plan) {
      // Set the line straight and shrink it under the crown, then drop the crown too.
      const avail = contentTop - contentBottom;
      const withCrown = avail - (crownH + GAP) - 2 * RULE_MARGIN;
      const bare = avail - 2 * RULE_MARGIN;
      if (withCrown >= PRIMARY_H_MIN) {
        plan = {
          crown: true,
          epithet: false,
          primaryH: Math.min(primaryTargetH, withCrown),
          arc: null,
          orbit: null,
        };
      } else if (bare >= PRIMARY_H_HARD_MIN) {
        plan = {
          crown: false,
          epithet: false,
          primaryH: Math.min(primaryTargetH, bare),
          arc: null,
          orbit: null,
        };
      }
    }
  }

  if (plan) {
    let y = contentTop;
    if (plan.crown) {
      pushCrown(els, cx, availW, { top: y, bot: y - crownH });
      y -= crownH + GAP;
    }
    const blockTop = y;
    y -= RULE_MARGIN;
    if (plan.arc) {
      pushArcName(els, cx, y, plan.arc);
    } else {
      pushText(els, "name", assets.font, primary, cx, y - plan.primaryH / 2, plan.primaryH, availW);
    }
    y -= plan.primaryH + (plan.arc ? plan.arc.rise : 0);
    if (plan.epithet && epithet) {
      const eh = EPITHET_RATIO * plan.primaryH;
      y -= EGAP;
      pushText(els, "epithet", assets.font, epithet, cx, y - eh / 2, eh, availW * 0.92);
      y -= eh;
    }
    y -= RULE_MARGIN;
    pushRules(els, cx, availW, blockTop, y);

    if (plan.orbit) {
      let positions = plan.orbit.positions;
      if (!hole) {
        // The planner parked the row at the content bottom; now that the name block's true bottom
        // is known, centre the row in the leftover band — a bottom-hugging row reads as
        // misaligned, while the arc around a pull hole already sits mid-band on its own.
        const dy = (y + contentBottom) / 2 - positions[0]!.y;
        positions = positions.map((q) => ({ x: q.x, y: q.y + dy }));
      }
      pushPips(els, cfg, positions, plan.orbit.pipD);
    }
  }

  return els;
}

function pushCrown(
  els: LidArtElement[],
  cx: number,
  availW: number,
  band: { top: number; bot: number },
): void {
  const w = availW * 0.95;
  const h = band.top - band.bot;
  els.push({
    id: "crown",
    pass: "foilGold",
    paths: crownPaths(cx, band.bot, w, h),
    fillRule: "nonzero",
    bbox: { x0: cx - w / 2, y0: band.bot, x1: cx + w / 2, y1: band.top },
  });
}

// The arched primary name: arc.commands warped point-by-point onto the circle whose band-bottom
// apex sits `bandH` below topY (so the cap apex touches topY exactly, like the straight line's
// band top).
function pushArcName(els: LidArtElement[], cx: number, topY: number, arc: ArcName): void {
  const { s, rise, rBase, bandH, phi, gb, commands } = arc;
  const cy = topY - bandH - rBase; // circle centre (lid-local)
  const gcx = (gb.x1 + gb.x2) / 2;
  const tx: Tx = (x, y) => {
    const th = Math.PI / 2 - ((x - gcx) * s) / rBase; // arc length along the band bottom
    const r = rBase + (gb.y2 - y) * s; // height above the band bottom (font y is down)
    return [cx + r * Math.cos(th), cy + r * Math.sin(th)];
  };
  const halfW = (rBase + bandH) * Math.sin(phi); // the outer top corners swing widest
  els.push({
    id: "name",
    pass: "foilGold",
    paths: [commandsToPath(commands, tx)],
    fillRule: "nonzero",
    bbox: { x0: cx - halfW, y0: topY - bandH - rise, x1: cx + halfW, y1: topY },
  });
}

// Two thin straight rules bracketing the whole name block (always present, even before the font
// loads). The top rule sits RULE_MARGIN above the arch's apex, so only the text itself curves.
function pushRules(
  els: LidArtElement[],
  cx: number,
  availW: number,
  blockTop: number,
  blockBottom: number,
): void {
  const ruleW = availW * 0.86;
  const rt = MIN_FOIL;
  els.push({
    id: "name-rules",
    pass: "foilGold",
    paths: [
      rectPath(cx - ruleW / 2, blockTop - rt, cx + ruleW / 2, blockTop),
      rectPath(cx - ruleW / 2, blockBottom, cx + ruleW / 2, blockBottom + rt),
    ],
    fillRule: "evenodd",
    bbox: { x0: cx - ruleW / 2, y0: blockBottom, x1: cx + ruleW / 2, y1: blockTop },
  });
}

// One line of text as glyph outlines, centred at (cx, cy), bbox height ≤ bandH, width ≤ availW.
function pushText(
  els: LidArtElement[],
  id: string,
  font: Font | null | undefined,
  text: string,
  cx: number,
  cy: number,
  bandH: number,
  availW: number,
): void {
  const t = text.trim().toUpperCase();
  if (!font || t.length === 0) return;
  const path = font.getPath(t, 0, 0, 100);
  const gb = path.getBoundingBox(); // font space: y down, baseline 0
  const gw = gb.x2 - gb.x1;
  const gh = gb.y2 - gb.y1;
  if (gw <= 0 || gh <= 0) return;
  const s = Math.min(bandH / gh, (availW * 0.94) / gw);
  const gcx = (gb.x1 + gb.x2) / 2;
  const gcy = (gb.y1 + gb.y2) / 2;
  const tx: Tx = (x, y) => [cx + (x - gcx) * s, cy - (y - gcy) * s];
  els.push({
    id,
    pass: "foilGold",
    paths: [commandsToPath(path.commands, tx)],
    fillRule: "nonzero",
    bbox: {
      x0: cx - (gw * s) / 2,
      y0: cy - (gh * s) / 2,
      x1: cx + (gw * s) / 2,
      y1: cy + (gh * s) / 2,
    },
  });
}

// The mana coins. Single mode: the healed knockout coin (one even-odd foil element). Multi mode: a
// solid gold disc on the foil layer plus the glyph on the dark-engrave layer inside it. A symbol
// whose glyph was never fetched degrades to a plain disc (a data gap, not a downgrade policy — the
// glyph ships whenever it exists).
function pushPips(
  els: LidArtElement[],
  cfg: LidArt,
  positions: { x: number; y: number }[],
  pipD: number,
): void {
  const pipR = pipD / 2;
  cfg.pips.forEach((code, i) => {
    const q = positions[i]!;
    const glyph = cfg.symbolPaths[code];
    const bbox: Bbox = { x0: q.x - pipR, y0: q.y - pipR, x1: q.x + pipR, y1: q.y + pipR };
    if (!glyph) {
      els.push({
        id: `pip-${i}`,
        pass: "foilGold",
        paths: [discPath(q.x, q.y, pipR)],
        fillRule: "evenodd",
        bbox,
      });
      return;
    }
    const coin = healedCoin(glyph, pipD);
    if (cfg.passMode === "multi") {
      els.push({
        id: `pip-${i}`,
        pass: "foilGold",
        paths: [discPath(q.x, q.y, pipR)],
        fillRule: "evenodd",
        bbox,
      });
      if (coin.glyph.length > 0) {
        els.push({
          id: `pip-${i}-glyph`,
          pass: "engrave",
          paths: [ringsToPath(coin.glyph, q.x, q.y)],
          fillRule: "evenodd",
          bbox,
        });
      }
    } else {
      els.push({
        id: `pip-${i}`,
        pass: "foilGold",
        paths: [ringsToPath(coin.foil, q.x, q.y)],
        fillRule: "evenodd",
        bbox,
      });
    }
  });
}
