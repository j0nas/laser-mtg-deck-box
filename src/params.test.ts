// Tests for the pure parameter/derived-dimension math — the numbers every cut panel hangs off.

import { matchPreset } from "parametric-kit/params";
import { describe, expect, test } from "vite-plus/test";
import {
  CAP,
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

  test("vertical stack-up: floor, cavity, groove, rail strip (frame-shrunk by default)", () => {
    const d = dims(defaults);
    const t = defaults.thickness;
    expect(d.slotZ).toBeCloseTo(t + d.innerH);
    expect(d.slotH).toBeCloseTo(t + defaults.lidFit);
    // The default box carries the lid frame, so the rail strip shrinks to seat it flush.
    expect(d.railStrip).toBeCloseTo(Math.max(t - defaults.lidFit, 0.6 * t));
    expect(d.grooveStop).toBeCloseTo(Math.max(1.5 * t, 5));
    expect(d.wallH).toBeCloseTo(d.slotZ + d.slotH + d.railStrip);
    expect(d.assembledH).toBeCloseTo(d.wallH); // the lid is sunken: nothing sticks up
  });

  test("lid frame: flush top when on, classic tall rail strip when off", () => {
    const t = defaults.thickness;
    const on = dims(defaults);
    // Flush: lid (slotZ..slotZ+t) plus frame (one more t) tops out exactly at the wall tops.
    expect(on.capW).toBeGreaterThan(0);
    expect(on.wallH).toBeCloseTo(on.slotZ + 2 * t);
    // The frame shares the lid's fit class: lidFit/2 per side against the recess walls.
    expect(on.capW).toBeCloseTo(on.innerW - defaults.lidFit);
    expect(on.capL).toBeCloseTo(on.lidL - CAP.backClear);
    // Off: the old stack-up, unchanged.
    const off = dims({ ...defaults, capRail: 0 });
    expect(off.capW).toBe(0);
    expect(off.capL).toBe(0);
    expect(off.railStrip).toBeCloseTo(Math.max(1.5 * t, 5));
    expect(off.wallH).toBeCloseTo(off.slotZ + off.slotH + Math.max(1.5 * t, 5));
    // A rail too wide for the minimum window drops the frame — and the flush shrink with it.
    const tiny = dims({ ...defaults, cardCount: 40, capRail: 12 });
    expect(tiny.capW).toBe(0);
    expect(tiny.railStrip).toBeCloseTo(Math.max(1.5 * t, 5));
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
    // All three stock sheets measure 3.0 mm, so every tie resolves to basswood (declared first) —
    // the default material at the default (measured) thickness.
    expect(materialFor(3.0).name).toBe("1/8″ basswood ply");
    expect(materialFor(3.2).name).toBe("1/8″ basswood ply");
    expect(materialFor(6).name).toBe("1/8″ basswood ply"); // nothing close -> nearest overall
  });
});
