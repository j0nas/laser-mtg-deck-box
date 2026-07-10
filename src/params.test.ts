// Tests for the pure parameter/derived-dimension math — the numbers every cut panel hangs off.

import { matchPreset } from "parametric-kit/params";
import { describe, expect, test } from "vite-plus/test";
import {
  capacity,
  DECK_PRESETS,
  defaults,
  dims,
  MATERIAL_PRESETS,
  materialFor,
  MATERIALS,
  SLEEVE_PRESETS,
} from "./params.ts";

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

  test("outer shell: one thickness front/back, two on the laminated sides", () => {
    const d = dims(defaults);
    expect(d.outerW).toBeCloseTo(d.innerW + 4 * defaults.thickness);
    expect(d.outerD).toBeCloseTo(d.innerD + 2 * defaults.thickness);
  });

  test("vertical stack-up: floor, cavity, groove, rail strip", () => {
    const d = dims(defaults);
    const t = defaults.thickness;
    expect(d.slotZ).toBeCloseTo(t + d.innerH);
    expect(d.slotH).toBeCloseTo(t + defaults.lidFit);
    expect(d.railStrip).toBeCloseTo(Math.max(1.5 * t, 5));
    expect(d.wallH).toBeCloseTo(d.slotZ + d.slotH + d.railStrip);
    expect(d.assembledH).toBeCloseTo(d.wallH); // the lid is sunken: nothing sticks up
  });

  test("the closing lid always clears the cards", () => {
    const d = dims(defaults);
    // Cards top out at floor + cardHeight; the lid's underside is the groove floor.
    expect(d.slotZ - defaults.thickness).toBeGreaterThanOrEqual(defaults.cardHeight);
  });

  test("lid rides one layer deep per side and stops at the back wall", () => {
    const d = dims(defaults);
    expect(d.lidW).toBeCloseTo(d.innerW + 2 * defaults.thickness - defaults.lidFit);
    expect(d.lidL).toBeCloseTo(d.innerD + defaults.thickness);
    expect(d.lidW).toBeLessThan(d.outerW - 2 * defaults.thickness); // never touches the outer layers
  });
});

describe("capacity", () => {
  test("round-trips deck + token headroom for every deck and sleeve preset", () => {
    for (const deck of DECK_PRESETS.presets) {
      for (const sleeve of SLEEVE_PRESETS.presets) {
        const p = { ...defaults, ...deck.set, ...sleeve.set };
        expect(capacity(p)).toBe(p.cardCount + defaults.extraCards);
        expect(capacity({ ...p, extraCards: 0 })).toBe(p.cardCount);
        expect(dims(p).innerH).toBeGreaterThanOrEqual(p.cardHeight);
      }
    }
  });
});

describe("presets", () => {
  test("deck counts and sleeve dimensions match the 3D-printed sibling app exactly", () => {
    expect(DECK_PRESETS.presets.map((p) => p.set.cardCount)).toEqual([40, 60, 75, 100]);
    expect(SLEEVE_PRESETS.presets.map((p) => p.set)).toEqual([
      { cardWidth: 63.5, cardHeight: 88.9, cardThickness: 0.305 },
      { cardWidth: 66, cardHeight: 91, cardThickness: 0.36 },
      { cardWidth: 66.5, cardHeight: 92, cardThickness: 0.6 },
      { cardWidth: 68, cardHeight: 93.5, cardThickness: 0.78 },
    ]);
  });

  test("default thickness matches the basswood preset", () => {
    expect(matchPreset(MATERIAL_PRESETS, defaults)).toBe("1/8″ basswood ply");
  });
});

describe("materials", () => {
  test("nearest-match lookup with declaration-order tie-break", () => {
    expect(MATERIALS.map((m) => m.name)).toEqual(["1/8″ basswood ply", "3mm MDF", "1/8″ acrylic"]);
    expect(materialFor(3.2).name).toBe("1/8″ basswood ply");
    expect(materialFor(3.0).name).toBe("3mm MDF"); // first declared at that thickness wins
    expect(materialFor(3.1).name).toBe("1/8″ basswood ply"); // equidistant -> declaration order
    expect(materialFor(6).name).toBe("1/8″ basswood ply"); // nothing close -> nearest overall
  });
});
