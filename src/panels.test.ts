// Geometry tests for the eight sliding-lid panels: comb complementarity, kerf press-fit growth,
// outline sanity, groove shape, assembled placement, and the lid. Pure Node — no DOM, no WASM.

import { bbox } from "parametric-kit/testkit";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, test } from "vite-plus/test";
import {
  applyPlace,
  combIntervals,
  fingerCount,
  LATCH,
  latchSpec,
  type Panel,
  panels,
  placeMatrix,
  type Pt,
} from "./panels.ts";
import { defaults, dims, type Params } from "./params.ts";

const d = dims(defaults);
const t = defaults.thickness;

const IDS = [
  "body-front",
  "body-back",
  "side-left-outer",
  "side-left-inner",
  "side-right-inner",
  "side-right-outer",
  "body-floor",
  "lid",
];

function panel(id: string, p: Params = defaults): Panel {
  const found = panels(p).find((pa) => pa.id === id);
  if (!found) throw new Error(`no panel ${id}`);
  return found;
}

function signedArea(outline: Pt[]): number {
  let a = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i]!;
    const [x2, y2] = outline[(i + 1) % outline.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function inPoly(outline: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i]!;
    const [xj, yj] = outline[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe("comb math", () => {
  test("mating phases partition the edge exactly (kerf = 0)", () => {
    for (const len of [d.wallH, d.slotZ, d.innerW, d.innerD]) {
      const n = fingerCount(len, defaults.fingerWidth);
      const a = combIntervals(len, n, true, 0).filter((iv) => iv.finger);
      const b = combIntervals(len, n, false, 0).filter((iv) => iv.finger);
      const all = [...a, ...b].sort((p, q) => p.a - q.a);
      expect(all[0]!.a).toBeCloseTo(0, 9);
      expect(all[all.length - 1]!.b).toBeCloseTo(len, 9);
      for (let i = 1; i < all.length; i++) expect(all[i]!.a).toBeCloseTo(all[i - 1]!.b, 9);
    }
  });

  test("kerf grows interior fingers by k, end fingers by k/2, and shrinks slots to match", () => {
    const k = 0.2;
    const n = fingerCount(d.wallH, defaults.fingerWidth);
    const plain = combIntervals(d.wallH, n, true, 0);
    const comp = combIntervals(d.wallH, n, true, k);
    for (let i = 0; i < n; i++) {
      const dLen = comp[i]!.b - comp[i]!.a - (plain[i]!.b - plain[i]!.a);
      const ends = (i === 0 ? 1 : 0) + (i === n - 1 ? 1 : 0);
      const expected = (plain[i]!.finger ? 1 : -1) * (k - (ends * k) / 2);
      expect(dLen).toBeCloseTo(expected, 9);
    }
  });
});

describe("outlines", () => {
  test("all eight panels exist, CCW, deduped, inside their declared size", () => {
    const all = panels(defaults);
    expect(all.map((p) => p.id)).toEqual(IDS);
    for (const p of all) {
      expect(p.outline.length).toBeGreaterThanOrEqual(4);
      expect(signedArea(p.outline)).toBeGreaterThan(0);
      for (let i = 0; i < p.outline.length; i++) {
        const [x1, y1] = p.outline[i]!;
        const [x2, y2] = p.outline[(i + 1) % p.outline.length]!;
        expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThan(1e-9);
        expect(x1).toBeGreaterThanOrEqual(-1e-9);
        expect(y1).toBeGreaterThanOrEqual(-1e-9);
        expect(x1).toBeLessThanOrEqual(p.size[0] + 1e-9);
        expect(y1).toBeLessThanOrEqual(p.size[1] + 1e-9);
      }
    }
  });

  test("outline envelopes stay exactly nominal even with kerf", () => {
    for (const p of panels({ ...defaults, kerf: 0.3 })) {
      const xs = p.outline.map((q) => q[0]);
      const ys = p.outline.map((q) => q[1]);
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
      expect(Math.min(...ys)).toBeCloseTo(0, 9);
      expect(Math.max(...xs)).toBeCloseTo(p.size[0], 9);
      expect(Math.max(...ys)).toBeCloseTo(p.size[1], 9);
    }
  });

  test("front corners: wide-wall fingers pass 2t deep where the side layers yield, and vice versa", () => {
    const p0 = { ...defaults, kerf: 0 };
    const front = panel("body-front", p0);
    const sideIn = panel("side-left-inner", p0);
    const sideOut = panel("side-left-outer", p0);
    const n = fingerCount(d.slotZ, defaults.fingerWidth);
    const seg = d.slotZ / n;
    // Segment 0 (bottom): wide-wall finger, both side layers recessed at their front edge.
    expect(inPoly(front.outline, t, seg / 2)).toBe(true); // reaches through both layers
    expect(inPoly(sideIn.outline, t / 2, seg / 2)).toBe(false);
    expect(inPoly(sideOut.outline, t / 2, seg / 2)).toBe(false);
    // Segment 1: the side layers own the corner column.
    expect(inPoly(front.outline, t, 1.5 * seg)).toBe(false);
    expect(inPoly(sideIn.outline, t / 2, 1.5 * seg)).toBe(true);
    expect(inPoly(sideOut.outline, t / 2, 1.5 * seg)).toBe(true);
  });

  test("the groove: inner layers open at the front, stopped at the back; outer layers solid", () => {
    const p0 = { ...defaults, kerf: 0 };
    const inner = panel("side-left-inner", p0);
    const outer = panel("side-left-outer", p0);
    const midSlot: Pt = [d.outerD / 2, d.slotZ + d.slotH / 2];
    expect(inPoly(inner.outline, ...midSlot)).toBe(false); // groove void
    expect(inPoly(outer.outline, ...midSlot)).toBe(true); // lamination caps it
    // The rail strip above and the wall below the groove are material in both layers.
    expect(inPoly(inner.outline, d.outerD / 2, d.wallH - d.railStrip / 2)).toBe(true);
    expect(inPoly(inner.outline, d.outerD / 2, d.slotZ - 1)).toBe(true);
    // Groove entry is open at the very front of the inner layer.
    expect(inPoly(inner.outline, 0.5, d.slotZ + d.slotH / 2)).toBe(false);
  });

  test("floor tabs fill the wall notches: t deep front/back, 2t deep through the sides", () => {
    const p0 = { ...defaults, kerf: 0 };
    const floor = panel("body-floor", p0);
    const front = panel("body-front", p0);
    const side = panel("side-left-inner", p0);
    const ivW = combIntervals(d.innerW, fingerCount(d.innerW, defaults.fingerWidth), false, 0);
    const ivD = combIntervals(d.innerD, fingerCount(d.innerD, defaults.fingerWidth), false, 0);
    const tabW = (ivW[1]!.a + ivW[1]!.b) / 2;
    const gapW = (ivW[0]!.a + ivW[0]!.b) / 2;
    const tabD = (ivD[1]!.a + ivD[1]!.b) / 2;
    // Floor: tab material reaches the outer faces under the tabs only.
    expect(inPoly(floor.outline, 2 * t + tabW, t / 2)).toBe(true);
    expect(inPoly(floor.outline, 2 * t + gapW, t / 2)).toBe(false);
    expect(inPoly(floor.outline, t, t + tabD)).toBe(true); // side tab, 2t reach
    // Walls: notch where the tab passes, material between.
    expect(inPoly(front.outline, 2 * t + tabW, t / 2)).toBe(false);
    expect(inPoly(front.outline, 2 * t + gapW, t / 2)).toBe(true);
    expect(inPoly(side.outline, t + tabD, t / 2)).toBe(false);
  });

  test("lid: rectangle with latch notches and a pull hole; both disappear when disabled", () => {
    const lid = panel("lid");
    const latch = latchSpec(defaults)!;
    expect(lid.outline.length).toBe(12); // 4 corners + two edge notches
    // Notch void at the nub's closed position, material just beyond it.
    expect(inPoly(lid.outline, d.lidW - t / 2, latch.uNub)).toBe(false);
    expect(inPoly(lid.outline, t / 2, latch.uNub)).toBe(false);
    expect(inPoly(lid.outline, d.lidW - t / 2, latch.uNub + LATCH.nubL)).toBe(true);
    expect(lid.holes.length).toBe(1);
    const hole = lid.holes[0]!;
    for (const [x, y] of hole) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(d.lidW);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(d.lidL);
    }
    const bare = panel("lid", { ...defaults, lidPull: 0, latchBump: 0 });
    expect(bare.outline.length).toBe(4);
    expect(bare.holes.length).toBe(0);
  });

  test("latch: spring tongue with nub in the inner layers, gone when off or when the box is tiny", () => {
    const p0 = { ...defaults, kerf: 0 };
    const inner = panel("side-left-inner", p0);
    const latch = latchSpec(p0)!;
    // Nub material rises into the groove; the groove void continues above it.
    expect(inPoly(inner.outline, latch.uNub, d.slotZ + latch.bump / 2)).toBe(true);
    expect(inPoly(inner.outline, latch.uNub, d.slotZ + latch.bump + 0.2)).toBe(false);
    // Tongue material above the U-slot void; anchored into solid wall behind.
    const midTongue = latch.uA + LATCH.tongueL / 2;
    expect(inPoly(inner.outline, midTongue, d.slotZ - LATCH.tongueW / 2)).toBe(true);
    expect(inPoly(inner.outline, midTongue, d.slotZ - LATCH.tongueW - LATCH.slotW / 2)).toBe(false);
    expect(inPoly(inner.outline, latch.uA + LATCH.tongueL + 3, d.slotZ - LATCH.tongueW / 2)).toBe(
      true,
    );
    // Off -> straight groove floor.
    const off = panel("side-left-inner", { ...p0, latchBump: 0 });
    expect(inPoly(off.outline, latch.uNub, d.slotZ + 0.15)).toBe(false);
    // A tiny box has no room for the spring: latch quietly disappears.
    const tiny = { ...defaults, cardCount: 10, extraCards: 0, cardThickness: 0.305 };
    expect(latchSpec(tiny)).toBeNull();
    expect(panels(tiny).find((pa) => pa.id === "lid")!.outline.length).toBe(4);
  });
});

describe("assembled placement", () => {
  function worldBox(p: Panel): { min: number[]; max: number[] } {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const cx of [0, p.size[0]]) {
      for (const cy of [0, p.size[1]]) {
        for (const cz of [0, t]) {
          const w = applyPlace([cx, cy, cz], p.place);
          for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a]!, w[a]!);
            max[a] = Math.max(max[a]!, w[a]!);
          }
        }
      }
    }
    return { min, max };
  }

  test("each panel occupies exactly its slab; the union is the closed box", () => {
    const all = panels(defaults);
    const lidX = (d.outerW - d.lidW) / 2;
    const expected: Record<string, number[][]> = {
      "body-front": [
        [0, 0, 0],
        [d.outerW, t, d.slotZ],
      ],
      "body-back": [
        [0, d.outerD - t, 0],
        [d.outerW, d.outerD, d.wallH],
      ],
      "side-left-outer": [
        [0, 0, 0],
        [t, d.outerD, d.wallH],
      ],
      "side-left-inner": [
        [t, 0, 0],
        [2 * t, d.outerD, d.wallH],
      ],
      "side-right-inner": [
        [d.outerW - 2 * t, 0, 0],
        [d.outerW - t, d.outerD, d.wallH],
      ],
      "side-right-outer": [
        [d.outerW - t, 0, 0],
        [d.outerW, d.outerD, d.wallH],
      ],
      "body-floor": [
        [0, 0, 0],
        [d.outerW, d.outerD, t],
      ],
      lid: [
        [lidX, 0, d.slotZ],
        [lidX + d.lidW, d.lidL, d.slotZ + t],
      ],
    };
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of all) {
      const box = worldBox(p);
      const exp = expected[p.id]!;
      for (let a = 0; a < 3; a++) {
        expect(box.min[a]).toBeCloseTo(exp[0]![a]!, 6);
        expect(box.max[a]).toBeCloseTo(exp[1]![a]!, 6);
        min[a] = Math.min(min[a]!, box.min[a]!);
        max[a] = Math.max(max[a]!, box.max[a]!);
      }
    }
    expect(min[0]).toBeCloseTo(0, 6);
    expect(min[1]).toBeCloseTo(0, 6);
    expect(min[2]).toBeCloseTo(0, 6);
    expect(max[0]).toBeCloseTo(d.outerW, 6);
    expect(max[1]).toBeCloseTo(d.outerD, 6);
    expect(max[2]).toBeCloseTo(d.wallH, 6);
  });

  test("the closed lid sits inside the groove band", () => {
    const lid = panel("lid");
    const zs = [0, t].map((w) => applyPlace([0, 0, w], lid.place)[2]);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(d.slotZ - 1e-9);
    expect(Math.max(...zs)).toBeLessThanOrEqual(d.slotZ + d.slotH + 1e-9);
  });

  test("placeMatrix agrees with applyPlace", () => {
    for (const p of panels(defaults)) {
      const m = placeMatrix(p.place);
      const [x, y, z] = [7, 11, 2];
      const viaMatrix = [
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
      ];
      const direct = applyPlace([x, y, z], p.place);
      for (let a = 0; a < 3; a++) expect(viaMatrix[a]).toBeCloseTo(direct[a]!, 9);
    }
  });
});

describe("misc", () => {
  test("panels() is deterministic", () => {
    expect(JSON.stringify(panels(defaults))).toBe(JSON.stringify(panels(defaults)));
  });

  test("kit testkit consumes a panel outline as flat geometry", () => {
    const front = panel("body-front", defaults);
    const flat = new Float32Array(front.outline.length * 3);
    front.outline.forEach(([x, y], i) => flat.set([x, y, 0], i * 3));
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(flat, 3));
    const b = bbox(g);
    // Float32Array storage rounds the coordinates, so compare at float precision.
    expect(b.max[0] - b.min[0]).toBeCloseTo(front.size[0], 3);
    expect(b.max[1] - b.min[1]).toBeCloseTo(front.size[1], 3);
  });
});
