// Tests for the pure parameter schema + derived-dimension math — the numbers every laser-cut panel
// hangs off. Pure Node: no DOM, no canvas.

import { describe, expect, test } from "vite-plus/test";
import {
  capacity,
  DECK_PRESETS,
  defaults,
  dims,
  effectiveNotchDepth,
  materialFor,
  MATERIAL_PRESETS,
  MATERIALS,
  type Params,
  SLEEVE_PRESETS,
} from "./params.ts";
import { applyPreset, matchPreset } from "parametric-kit/params";

describe("capacity", () => {
  test("is cardCount + extraCards for the defaults", () => {
    expect(capacity(defaults)).toBe(defaults.cardCount + defaults.extraCards);
  });
});

describe("dims", () => {
  test("cavity wraps the card stack plus token headroom plus clearances", () => {
    const d = dims(defaults);
    expect(d.stackD).toBeCloseTo(defaults.cardCount * defaults.cardThickness);
    expect(d.innerW).toBeCloseTo(defaults.cardWidth + 2 * defaults.sideClearance);
    expect(d.innerD).toBeCloseTo(
      d.stackD + defaults.extraCards * defaults.cardThickness + defaults.stackClearance,
    );
    expect(d.innerH).toBeCloseTo(defaults.cardHeight + defaults.headroom);
  });

  test("body outer footprint adds one wall thickness on every side", () => {
    const d = dims(defaults);
    expect(d.bodyOuterW).toBeCloseTo(d.innerW + 2 * defaults.thickness);
    expect(d.bodyOuterD).toBeCloseTo(d.innerD + 2 * defaults.thickness);
    expect(d.bodyH).toBeCloseTo(defaults.thickness + d.innerH);
  });

  test("cap socket clears the body's outside by capFit, then adds its own wall", () => {
    const d = dims(defaults);
    expect(d.capInnerW).toBeCloseTo(d.bodyOuterW + 2 * defaults.capFit);
    expect(d.capInnerD).toBeCloseTo(d.bodyOuterD + 2 * defaults.capFit);
    expect(d.capOuterW).toBeCloseTo(d.capInnerW + 2 * defaults.thickness);
    expect(d.capOuterD).toBeCloseTo(d.capInnerD + 2 * defaults.thickness);
  });

  test("cap height is its skirt depth plus a top thickness", () => {
    const d = dims(defaults);
    expect(d.capH).toBeCloseTo(defaults.capDepth + defaults.thickness);
  });

  test("assembled height = body height + cap's top thickness (skirt overlap is not extra height)", () => {
    const d = dims(defaults);
    expect(d.assembledH).toBeCloseTo(d.bodyH + defaults.thickness);
    // equivalent formulation, spelled out from capH and capDepth directly
    expect(d.assembledH).toBeCloseTo(d.bodyH + (d.capH - defaults.capDepth));
  });

  test("cards never protrude above the body walls: innerH is exactly card height + headroom", () => {
    const d = dims(defaults);
    expect(d.innerH).toBeGreaterThanOrEqual(defaults.cardHeight);
    // holds for any non-negative headroom, not just the default
    const p: Params = { ...defaults, headroom: 4.5 };
    expect(dims(p).innerH).toBeGreaterThanOrEqual(p.cardHeight);
  });
});

describe("effectiveNotchDepth", () => {
  test("passes through a notch depth already inside the cap depth", () => {
    const p: Params = { ...defaults, notchDepth: 10, capDepth: 30 };
    expect(effectiveNotchDepth(p)).toBe(10);
  });

  test("clamps a notch depth that would poke out past the cap's skirt", () => {
    // Bypass the schema's maxKey slider clamp entirely (e.g. a hand-built params blob, or one
    // restored before clampCeilings ran) — the derived helper must still guarantee the invariant.
    const p: Params = { ...defaults, notchDepth: 999, capDepth: 18 };
    expect(effectiveNotchDepth(p)).toBe(18);
    expect(effectiveNotchDepth(p)).toBeLessThanOrEqual(p.capDepth);
  });
});

describe("presets", () => {
  test("DECK_PRESETS mirror parametric-mtg-deck-box's counts exactly", () => {
    expect(DECK_PRESETS.presets.map((p) => [p.name, p.set.cardCount])).toEqual([
      ["Draft / limited (40)", 40],
      ["Standard (60)", 60],
      ["Standard + sideboard (75)", 75],
      ["Commander (100)", 100],
    ]);
  });

  test("SLEEVE_PRESETS mirror parametric-mtg-deck-box's card dims exactly", () => {
    expect(
      SLEEVE_PRESETS.presets.map((p) => [
        p.name,
        p.set.cardWidth,
        p.set.cardHeight,
        p.set.cardThickness,
      ]),
    ).toEqual([
      ["Unsleeved", 63.5, 88.9, 0.305],
      ["Penny sleeves", 66, 91, 0.36],
      ["Standard sleeves", 66.5, 92, 0.6],
      ["Double sleeved", 68, 93.5, 0.78],
    ]);
  });

  test("capacity round-trips across every deck x sleeve preset combination", () => {
    for (const deck of DECK_PRESETS.presets) {
      for (const sleeve of SLEEVE_PRESETS.presets) {
        const p: Params = { ...defaults };
        applyPreset(DECK_PRESETS, deck.name, p);
        applyPreset(SLEEVE_PRESETS, sleeve.name, p);
        expect(capacity(p)).toBe(p.cardCount + p.extraCards);
        expect(matchPreset(DECK_PRESETS, p)).toBe(deck.name);
        expect(matchPreset(SLEEVE_PRESETS, p)).toBe(sleeve.name);
        // dims must stay finite and sane for every combination
        const d = dims(p);
        expect(d.innerD).toBeGreaterThan(0);
        expect(d.assembledH).toBeGreaterThan(d.bodyH);
      }
    }
  });

  test("MATERIAL_PRESETS expose basswood/MDF/acrylic at their documented thicknesses", () => {
    expect(MATERIAL_PRESETS.presets.map((p) => [p.name, p.set.thickness])).toEqual([
      ["1/8″ basswood ply", 3.2],
      ["3mm MDF", 3.0],
      ["1/8″ acrylic", 3.0],
    ]);
  });
});

describe("MATERIALS / materialFor", () => {
  test("declares the documented densities (g/cm³)", () => {
    expect(MATERIALS).toEqual([
      { name: "1/8″ basswood ply", thickness: 3.2, density: 0.45 },
      { name: "3mm MDF", thickness: 3.0, density: 0.75 },
      { name: "1/8″ acrylic", thickness: 3.0, density: 1.19 },
    ]);
  });

  test("sanity: the default material thickness looks up basswood ply", () => {
    expect(materialFor(defaults.thickness).name).toBe("1/8″ basswood ply");
  });

  test("nearest-match lookup, ties favoring the earlier (basswood-first) entry", () => {
    expect(materialFor(3.0).name).toBe("3mm MDF"); // exact match, first of the two 3.0mm entries
    expect(materialFor(3.1).name).toBe("1/8″ basswood ply"); // equidistant from 3.2 and 3.0 -> basswood wins (declared first)
    expect(materialFor(6).name).toBe("1/8″ basswood ply"); // nothing close -> nearest is still basswood
  });
});
