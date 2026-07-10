// Parameters for the laser-cut MTG deck box: a finger-jointed open-top box holding a vertical stack
// of sleeved cards (width along X, stack along Y, height up Z), closed by a LID that SLIDES
// front-to-back in hidden grooves. The grooves come from laminated side walls — each side is an
// inner layer carrying the groove profile glued to a full outer layer — so the box reads as clean
// solid walls with a sunken sliding top. Eight flat panels, cut from sheet stock. All millimetres.
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

  lidFit: num({
    def: 0.3,
    min: 0.1,
    max: 0.8,
    step: 0.05,
    group: "fit",
    label: "Lid slide clearance",
  }),
  latchBump: num({
    def: 0.35,
    min: 0,
    max: 0.8,
    step: 0.05,
    group: "fit",
    label: "Latch click (0 = off)",
  }),

  lidPull: num({
    def: 12,
    min: 0,
    max: 20,
    step: 1,
    group: "retrieval",
    label: "Lid pull hole Ø (0 = off)",
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
  innerW: number; // cavity width / depth / height
  innerD: number;
  innerH: number;
  outerW: number; // outer footprint — the sides are TWO layers thick (groove lamination)
  outerD: number;
  slotZ: number; // groove floor: the lid's underside when closed
  slotH: number; // groove height: one thickness + the slide clearance
  railStrip: number; // material left above the groove (glued full-length to the outer layer)
  wallH: number; // full wall height = closed-box height
  lidW: number; // lid rides one inner-layer deep in each groove, minus the slide clearance
  lidL: number; // front face flush to the back wall's inner face
  assembledH: number; // = wallH: the lid is sunken, nothing sticks up
};

// Derived panel dimensions, shared by the panel-geometry builder, SVG export and the tests.
//
// The cavity wraps the card stack (+ token headroom + stack clearance along the stack axis, + side
// clearance across the width, + headroom above the card tops). The front and back walls add one
// thickness each; the SIDES add two (inner groove layer + outer layer). Cards never poke above the
// groove floor because slotZ - floor = innerH = cardHeight + headroom (headroom >= 0), so the
// closing lid always clears them.
//
// Vertical stack-up: floor thickness, cavity, then the groove (one thickness + lidFit of slack for
// the sliding lid) and a rail strip above it. The strip can be modest — max(1.5·t, 5 mm) — because
// lamination glues it to the outer layer along its whole length; it is not a free-hanging bridge.
export function dims(p: Params): Dims {
  const t = p.thickness;
  const stackD = p.cardCount * p.cardThickness;
  const innerW = p.cardWidth + 2 * p.sideClearance;
  const innerD = stackD + p.extraCards * p.cardThickness + p.stackClearance;
  const innerH = p.cardHeight + p.headroom;
  const outerW = innerW + 4 * t;
  const outerD = innerD + 2 * t;
  const slotZ = t + innerH;
  const slotH = t + p.lidFit;
  const railStrip = Math.max(1.5 * t, 5);
  const wallH = slotZ + slotH + railStrip;
  const lidW = innerW + 2 * t - p.lidFit;
  const lidL = innerD + t;
  return {
    stackD,
    innerW,
    innerD,
    innerH,
    outerW,
    outerD,
    slotZ,
    slotH,
    railStrip,
    wallH,
    lidW,
    lidL,
    assembledH: wallH,
  };
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
