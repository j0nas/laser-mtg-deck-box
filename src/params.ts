// Parameters for the laser-cut MTG deck box: a finger-jointed open-top BODY holding a vertical stack
// of sleeved cards (width along X, stack along Y, height up Z), and a finger-jointed telescoping CAP
// (open-bottom box) that slides down over it. Ten flat panels, cut from sheet stock. All millimetres.
// Pure / framework-free so panel geometry, SVG export and the viewer share one source of truth.

import {
  defaults as computeDefaults,
  defineParams,
  definePresets,
  type Infer,
  num,
} from "parametric-kit/params";

export const schema = defineParams({
  cardCount: num({ def: 100, min: 10, max: 250, step: 1, group: "cards", label: "Card count" }),
  extraCards: num({
    def: 10,
    min: 0,
    max: 40,
    step: 1,
    group: "cards",
    label: "Token headroom (cards)",
  }),
  cardWidth: num({
    def: 66.5,
    min: 60,
    max: 72,
    step: 0.1,
    group: "cards",
    label: "Card width (sleeved)",
  }),
  cardHeight: num({
    def: 92,
    min: 85,
    max: 97,
    step: 0.1,
    group: "cards",
    label: "Card height (sleeved)",
  }),
  cardThickness: num({
    def: 0.6,
    min: 0.25,
    max: 1.2,
    step: 0.005,
    group: "cards",
    label: "Card thickness",
  }),
  sideClearance: num({
    def: 1,
    min: 0,
    max: 3,
    step: 0.1,
    group: "cards",
    label: "Side clearance",
  }),
  stackClearance: num({
    def: 2,
    min: 0,
    max: 10,
    step: 0.5,
    group: "cards",
    label: "Stack clearance",
  }),
  headroom: num({ def: 2, min: 0, max: 5, step: 0.5, group: "cards", label: "Headroom" }),

  thickness: num({
    def: 3.2,
    min: 2,
    max: 6,
    step: 0.1,
    group: "material",
    label: "Sheet thickness",
  }),
  kerf: num({ def: 0.15, min: 0, max: 0.5, step: 0.01, group: "material", label: "Kerf" }),
  fingerWidth: num({
    def: 10,
    min: 5,
    max: 20,
    step: 0.5,
    group: "material",
    label: "Finger width",
  }),

  capFit: num({
    def: 0.2,
    min: 0.05,
    max: 0.6,
    step: 0.05,
    group: "fit",
    label: "Cap fit clearance",
  }),
  capDepth: num({ def: 30, min: 15, max: 60, step: 1, group: "fit", label: "Cap depth" }),

  notchWidth: num({
    def: 20,
    min: 0,
    max: 40,
    step: 1,
    group: "retrieval",
    label: "Notch width (0 = off)",
  }),
  notchDepth: num({
    def: 10,
    min: 4,
    max: 20,
    step: 0.5,
    group: "retrieval",
    label: "Notch depth",
    maxKey: "capDepth", // the cap always slides down capDepth, so the notch must stay inside it
  }),
  sideRecessWidth: num({
    def: 0,
    min: 0,
    max: 30,
    step: 1,
    group: "retrieval",
    label: "Side recess width (0 = off)",
  }),

  sheetW: num({ def: 300, min: 100, max: 1000, step: 10, group: "sheet", label: "Sheet width" }),
  sheetH: num({ def: 300, min: 100, max: 1000, step: 10, group: "sheet", label: "Sheet height" }),
  partGap: num({ def: 3, min: 1, max: 10, step: 0.5, group: "sheet", label: "Part gap" }),
});

export type Params = Infer<typeof schema>;

export const defaults: Params = computeDefaults(schema);

// How many cards (including token headroom) the box is sized for.
export function capacity(p: Params): number {
  return p.cardCount + p.extraCards;
}

export type Dims = {
  stackD: number; // depth of the card stack itself
  innerW: number; // body cavity width / depth / height
  innerD: number;
  innerH: number;
  bodyOuterW: number; // body footprint (outside the walls)
  bodyOuterD: number;
  bodyH: number; // body height: floor to open top rim
  capInnerW: number; // cap socket (what slides down over the body's outside)
  capInnerD: number;
  capOuterW: number; // cap footprint (outside its own walls)
  capOuterD: number;
  capH: number; // cap height: open bottom edge to its top face
  assembledH: number; // closed-box height, body sitting on the bench with the cap seated
};

// Derived panel dimensions, shared by the panel-geometry builder, SVG export and the tests.
//
// The body is an open-top box: its cavity wraps the card stack (+ token headroom + stack clearance
// along the stack axis, + side clearance across the width, + headroom above the card tops), and its
// walls add one material thickness on every side, with the floor adding one more thickness at the
// bottom. Cards never poke out the top because innerH === cardHeight + headroom by construction
// (headroom >= 0), so the cavity is always at least as tall as a card.
//
// The cap is an open-bottom telescoping box that slides down over the OUTSIDE of the body: its socket
// clears the body's outer footprint by capFit per side, and its own walls add one more thickness
// outside that. Because the cap's skirt overlaps the body over capDepth of the body's own height, the
// assembled height is just the body height plus the cap's top thickness (the overlapped portion of
// the cap is not extra height) — equivalently bodyH + (capH - capDepth), since capH = capDepth +
// thickness.
export function dims(p: Params): Dims {
  const stackD = p.cardCount * p.cardThickness;
  const innerW = p.cardWidth + 2 * p.sideClearance;
  const innerD = stackD + p.extraCards * p.cardThickness + p.stackClearance;
  const innerH = p.cardHeight + p.headroom;
  const bodyOuterW = innerW + 2 * p.thickness;
  const bodyOuterD = innerD + 2 * p.thickness;
  const bodyH = p.thickness + innerH; // floor thickness + cavity height
  const capInnerW = bodyOuterW + 2 * p.capFit;
  const capInnerD = bodyOuterD + 2 * p.capFit;
  const capOuterW = capInnerW + 2 * p.thickness;
  const capOuterD = capInnerD + 2 * p.thickness;
  const capH = p.capDepth + p.thickness; // skirt depth + top thickness
  const assembledH = bodyH + p.thickness;
  return {
    stackD,
    innerW,
    innerD,
    innerH,
    bodyOuterW,
    bodyOuterD,
    bodyH,
    capInnerW,
    capInnerD,
    capOuterW,
    capOuterD,
    capH,
    assembledH,
  };
}

// The notch's real depth, capped at capDepth so the closed cap always hides it — mirrors the
// schema's maxKey ceiling (see notchDepth above), but stays correct even for a params blob that
// bypassed the slider clamp (e.g. hand-built in a test, or restored from an older schema version
// before clampCeilings ran).
export function effectiveNotchDepth(p: Params): number {
  return Math.min(p.notchDepth, p.capDepth);
}

// One-click deck sizes. Picking one sets only the card count. Counts match
// parametric-mtg-deck-box's DECK_PRESETS exactly.
export const DECK_PRESETS = definePresets<typeof schema>({
  id: "deck",
  label: "Deck preset",
  presets: [
    { name: "Draft / limited (40)", set: { cardCount: 40 } },
    { name: "Standard (60)", set: { cardCount: 60 } },
    { name: "Standard + sideboard (75)", set: { cardCount: 75 } },
    { name: "Commander (100)", set: { cardCount: 100 } },
  ],
});

// Sleeved-card sizes (mm). Values match parametric-mtg-deck-box's SLEEVE_PRESETS exactly.
export const SLEEVE_PRESETS = definePresets<typeof schema>({
  id: "sleeve",
  label: "Sleeves",
  presets: [
    { name: "Unsleeved", set: { cardWidth: 63.5, cardHeight: 88.9, cardThickness: 0.305 } },
    { name: "Penny sleeves", set: { cardWidth: 66, cardHeight: 91, cardThickness: 0.36 } },
    { name: "Standard sleeves", set: { cardWidth: 66.5, cardHeight: 92, cardThickness: 0.6 } },
    { name: "Double sleeved", set: { cardWidth: 68, cardHeight: 93.5, cardThickness: 0.78 } },
  ],
});

// Sheet materials: what the "thickness" slider actually maps to, plus density for mass/weight
// readouts. Keyed by name since two materials can share a thickness (3 mm MDF and 3 mm acrylic) —
// `materialFor` below is the lookup rule that resolves a live thickness back to one of these.
export type MaterialInfo = { name: string; thickness: number; density: number }; // density: g/cm³

export const MATERIALS: MaterialInfo[] = [
  { name: "1/8″ basswood ply", thickness: 3.2, density: 0.45 }, // default material
  { name: "3mm MDF", thickness: 3.0, density: 0.75 },
  { name: "1/8″ acrylic", thickness: 3.0, density: 1.19 },
];

export const MATERIAL_PRESETS = definePresets<typeof schema>({
  id: "material",
  label: "Sheet material",
  presets: MATERIALS.map((m) => ({
    name: m.name,
    set: { thickness: m.thickness },
    matchOn: ["thickness"] as (keyof Params)[],
  })),
});

// Resolve the current `thickness` param to a MaterialInfo: nearest match by thickness, ties (and the
// "nothing is close" case, since nearest-of-any-list is always defined) broken in MATERIALS'
// declaration order — so an exact or near-exact 3.2 mm match, or any value roughly equidistant from
// basswood and something else, falls back to basswood ply, the schema's default material.
export function materialFor(thicknessMm: number): MaterialInfo {
  let best = MATERIALS[0]!;
  let bestDelta = Math.abs(thicknessMm - best.thickness);
  for (const m of MATERIALS) {
    const delta = Math.abs(thicknessMm - m.thickness);
    if (delta < bestDelta) {
      best = m;
      bestDelta = delta;
    }
  }
  return best;
}
