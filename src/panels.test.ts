// Geometry tests for the nine sliding-lid panels: comb complementarity, kerf press-fit growth,
// outline sanity, groove shape, assembled placement, the lid and its frame. Pure Node — no DOM,
// no WASM.

import { bbox, pointInPolygon as inPoly, signedArea } from "parametric-kit/testkit";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, test } from "vite-plus/test";
import {
  applyPlace,
  capSpec,
  combIntervals,
  fingerCount,
  LATCH,
  latchSpec,
  type Panel,
  panels,
  placeMatrix,
  pullHole,
  thumbNotch,
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
  "lid-cap",
];

function panel(id: string, p: Params = defaults): Panel {
  const found = panels(p).find((pa) => pa.id === id);
  if (!found) throw new Error(`no panel ${id}`);
  return found;
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
  test("all nine panels exist, CCW, deduped, inside their declared size", () => {
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

  test("the groove: open at the front, stopped at a back ligament; outer layers solid", () => {
    const p0 = { ...defaults, kerf: 0 };
    const inner = panel("side-left-inner", p0);
    const outer = panel("side-left-outer", p0);
    const midV = d.slotZ + d.slotH / 2;
    const reach = d.outerD - t - d.grooveStop; // the groove's back end
    expect(inPoly(inner.outline, d.outerD / 2, midV)).toBe(false); // groove void
    expect(inPoly(outer.outline, d.outerD / 2, midV)).toBe(true); // lamination caps it
    // The rail strip above and the wall below the groove are material in both layers.
    expect(inPoly(inner.outline, d.outerD / 2, d.wallH - d.railStrip / 2)).toBe(true);
    expect(inPoly(inner.outline, d.outerD / 2, d.slotZ - 1)).toBe(true);
    // Groove entry is open at the very front of the inner layer; void runs to the back end.
    expect(inPoly(inner.outline, 0.5, midV)).toBe(false);
    expect(inPoly(inner.outline, reach - 2, midV)).toBe(false);
    // MATERIAL through the ligament behind the groove: it sits inboard of the back comb's t-deep
    // slot recesses, so the rail strip stays tied to the body whatever the comb phase.
    expect(inPoly(inner.outline, d.outerD - t - d.grooveStop / 2, midV)).toBe(true);
  });

  test("ligament survives even when the back comb phases a slot across the groove band", () => {
    // fingerWidth 20 makes the back comb's groove-height interval a SLOT (recessed to outerD - t)
    // spanning the whole groove band — under the old outerD - t groove reach that severed the rail
    // strip into a separate part. The ligament stops the groove short of the recess.
    const p = { ...defaults, kerf: 0, fingerWidth: 20 };
    const dd = dims(p);
    const iv = combIntervals(dd.wallH, fingerCount(dd.wallH, p.fingerWidth), false, 0);
    const band = iv.find((i) => i.a <= dd.slotZ && dd.slotZ + dd.slotH <= i.b);
    expect(band).toBeDefined();
    expect(band!.finger).toBe(false); // the premise: the groove band lies inside a slot recess
    const inner = panel("side-left-inner", p);
    const midV = dd.slotZ + dd.slotH / 2;
    expect(inPoly(inner.outline, dd.outerD - p.thickness - dd.grooveStop / 2, midV)).toBe(true);
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

  test("lid: relieved back corners, latch notches, pull hole; optional features disappear", () => {
    const lid = panel("lid");
    const latch = latchSpec(defaults)!;
    const backCut = d.grooveStop + defaults.lidFit;
    expect(lid.outline.length).toBe(16); // 4 corners + two back reliefs + two latch notches
    // Back-corner relief: void at both back corners, material between them and at the square
    // front corners. The relief is longer than the ligament, so the shoulders sit lidFit short of
    // the bridge faces and the back edge always bottoms out on the back wall first.
    expect(inPoly(lid.outline, t / 2, d.lidL - 1)).toBe(false);
    expect(inPoly(lid.outline, d.lidW - t / 2, d.lidL - 1)).toBe(false);
    expect(inPoly(lid.outline, t + 2, d.lidL - 1)).toBe(true);
    expect(inPoly(lid.outline, t / 2, 1)).toBe(true);
    expect(inPoly(lid.outline, d.lidW - t / 2, 1)).toBe(true);
    expect(backCut).toBeGreaterThan(d.grooveStop);
    // Latch notch void at the nub's closed position, material just beyond it.
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
    expect(bare.outline.length).toBe(8); // the back relief is structural: it never disappears
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
    expect(panels(tiny).find((pa) => pa.id === "lid")!.outline.length).toBe(8); // relief stays
  });
});

describe("thumb notch", () => {
  const nt = thumbNotch(defaults)!;

  test("scallops the front wall's top edge into a U-shaped void", () => {
    const front = panel("body-front");
    // Void through the notch: at the top-centre and just above the semicircular bottom.
    expect(inPoly(front.outline, d.outerW / 2, d.slotZ - 1)).toBe(false);
    expect(inPoly(front.outline, d.outerW / 2, d.slotZ - nt.depth + 1)).toBe(false);
    // Material just below the notch bottom and to either side of it.
    expect(inPoly(front.outline, d.outerW / 2, d.slotZ - nt.depth - 2)).toBe(true);
    expect(inPoly(front.outline, nt.cx + nt.halfW + 2, d.slotZ - 1)).toBe(true);
    expect(inPoly(front.outline, nt.cx - (nt.halfW + 2), d.slotZ - 1)).toBe(true);
  });

  test("off (width 0) leaves the top edge solid and returns null", () => {
    const off = { ...defaults, notchWidth: 0 };
    expect(inPoly(panel("body-front", off).outline, d.outerW / 2, d.slotZ - 1)).toBe(true);
    expect(thumbNotch(off)).toBeNull();
  });

  test("dips inward only: envelope, size and winding stay nominal", () => {
    const front = panel("body-front");
    // The U cuts DOWN from the top edge, so the blank's max y is still the nominal top.
    expect(Math.max(...front.outline.map((q) => q[1]))).toBeCloseTo(d.slotZ, 9);
    expect(front.size).toEqual([d.outerW, d.slotZ]);
    expect(signedArea(front.outline)).toBeGreaterThan(0);
  });

  test("depth floors to the semicircle radius so the bottom is a true half-round", () => {
    // Width 30, innerW 68.5 -> halfW 15 (no width clamp); depth 5 floors up to halfW.
    const nt2 = thumbNotch({ ...defaults, notchWidth: 30, notchDepth: 5 })!;
    expect(nt2.halfW).toBe(15);
    expect(nt2.depth).toBe(15);
  });

  test("default placement is front-only: the back wall stays solid", () => {
    expect(defaults.notchWalls).toBe("front");
    expect(inPoly(panel("body-back").outline, d.outerW / 2, d.wallH - 1)).toBe(true);
  });

  test("back placement: front solid, back notched down to the same lid-plane depth", () => {
    const p = { ...defaults, notchWalls: "back" as const };
    expect(inPoly(panel("body-front", p).outline, d.outerW / 2, d.slotZ - 1)).toBe(true);
    const back = panel("body-back", p).outline;
    // Void at the back wall's own top edge and just above the shared bottom (measured from the LID
    // plane, slotZ — this pins the equal-bottom-Z invariant across the two wall heights)…
    expect(inPoly(back, d.outerW / 2, d.wallH - 1)).toBe(false);
    expect(inPoly(back, d.outerW / 2, d.slotZ - nt.depth + 1)).toBe(false);
    // …and material just below that shared bottom.
    expect(inPoly(back, d.outerW / 2, d.slotZ - nt.depth - 2)).toBe(true);
  });

  test("both placement: both walls scalloped at their top edges", () => {
    const p = { ...defaults, notchWalls: "both" as const };
    expect(inPoly(panel("body-front", p).outline, d.outerW / 2, d.slotZ - 1)).toBe(false);
    expect(inPoly(panel("body-back", p).outline, d.outerW / 2, d.wallH - 1)).toBe(false);
  });

  test("a notched back wall keeps its nominal envelope and CCW winding", () => {
    const back = panel("body-back", { ...defaults, notchWalls: "back" as const });
    expect(Math.max(...back.outline.map((q) => q[1]))).toBeCloseTo(d.wallH, 9);
    expect(back.size).toEqual([d.outerW, d.wallH]);
    expect(signedArea(back.outline)).toBeGreaterThan(0);
  });
});

describe("lid frame", () => {
  const cap = capSpec(defaults)!;
  const frame = panel("lid-cap");
  const hole = frame.holes[0]!;
  // Material at (x, y) in cap-local mm: inside the blank and not inside the window cutout.
  const material = (x: number, y: number) => inPoly(frame.outline, x, y) && !inPoly(hole, x, y);

  test("spec: sized to the recess, window inset by the rail, all ornaments present at defaults", () => {
    expect(cap.w).toBeCloseTo(d.capW, 9);
    expect(cap.l).toBeCloseTo(d.capL, 9);
    expect(cap.window).toEqual({
      x0: defaults.capRail,
      y0: defaults.capRail,
      x1: d.capW - defaults.capRail,
      y1: d.capL - defaults.capRail,
    });
    expect(cap.scallop).not.toBeNull();
    expect(cap.arch).not.toBeNull();
    expect(cap.cusp).toBeGreaterThan(0);
  });

  test("a joint-free blank with a CW-wound window hole strictly inside it", () => {
    expect(frame.outline.length).toBe(4); // plain rectangle: no combs, no reliefs
    expect(frame.size).toEqual([cap.w, cap.l]);
    expect(signedArea(hole)).toBeLessThan(0); // holes wind CW
    for (const [x, y] of hole) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(cap.w);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(cap.l);
    }
  });

  test("window void in the middle, rail material on all four sides", () => {
    expect(material(cap.w / 2, cap.l / 2)).toBe(false); // the window
    expect(material(3, cap.l / 2)).toBe(true); // left rail
    expect(material(cap.w - 3, cap.l / 2)).toBe(true); // right rail
    expect(material(cap.w / 2, 0.7)).toBe(true); // front-rail ligament under the scallop
    expect(material(cap.w / 2, cap.l - 0.7)).toBe(true); // back-rail ligament over the arch
  });

  test("thumb scallop: void dipped into the front rail, material either side of it", () => {
    const s = cap.scallop!;
    expect(material(s.cx, cap.window.y0 - s.depth / 2)).toBe(false); // inside the dip
    expect(material(s.cx - s.halfW - 2, cap.window.y0 - s.depth / 2)).toBe(true);
    expect(material(s.cx + s.halfW + 2, cap.window.y0 - s.depth / 2)).toBe(true);
    // The dip keeps the CAP.scallopLig ligament: void just above it, material just below.
    expect(material(s.cx, cap.window.y0 - s.depth + 0.3)).toBe(false);
    expect(material(s.cx, cap.window.y0 - s.depth - 0.3)).toBe(true);
  });

  test("crown arch: void risen into the back rail at the centre, straight edge at the flanks", () => {
    const a = cap.arch!;
    const cx = cap.w / 2;
    expect(material(cx, cap.window.y1 + 1)).toBe(false); // under the peak
    expect(material(cx, cap.window.y1 + a.h + a.tip + 0.3)).toBe(true); // over the peak
    expect(material(cx + a.halfW + 2, cap.window.y1 + 0.5)).toBe(true); // beyond the wings
    expect(material(cx - a.halfW - 2, cap.window.y1 + 0.5)).toBe(true);
    // The wing is concave: halfway out, the void has risen far less than half the arch height.
    const midX = cx + (a.plateau + a.halfW) / 2;
    expect(material(midX, cap.window.y1 + a.h * 0.45)).toBe(true);
  });

  test("cathedral cusps: frame material points into the window at each square corner", () => {
    const { x0, y0, x1, y1 } = cap.window;
    for (const [qx, qy] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ] as const) {
      const inward = (v: number, lo: number) => (v === lo ? 1 : -1);
      const dx = inward(qx, x0);
      const dy = inward(qy, y0);
      expect(material(qx + dx * 1, qy + dy * 1)).toBe(true); // inside the cusp's quarter disc
      expect(material(qx + dx * (cap.cusp + 1), qy + dy * (cap.cusp + 1))).toBe(false); // past it
    }
  });

  test("flush lamination: the frame rides the lid's top face and tops out at the wall height", () => {
    expect(frame.place.pos).toEqual([(d.outerW - cap.w) / 2, 0, d.slotZ + t]);
    expect(d.slotZ + 2 * t).toBeCloseTo(d.wallH, 9);
  });

  test("the pull hole rides above the window's front rail so it stays visible", () => {
    const wide = pullHole({ ...defaults, capRail: 12 })!;
    expect(wide.cy - wide.r).toBeGreaterThanOrEqual(12 + 1 - 1e-9); // clear of the front rail
    const bare = pullHole({ ...defaults, capRail: 0 })!;
    expect(bare.cy).toBeCloseTo(14, 9); // classic position without the frame
  });

  test("ornaments degrade on a skinny rail; the frame itself drops with its window", () => {
    const skinny = capSpec({ ...defaults, capRail: 2 })!;
    expect(skinny.scallop).toBeNull(); // no room for the ligament
    expect(skinny.arch).toBeNull();
    expect(skinny.cusp).toBe(0); // falls back to plain rounded corners
    expect(capSpec({ ...defaults, capRail: 0 })).toBeNull();
    expect(panels({ ...defaults, capRail: 0 }).map((p) => p.id)).not.toContain("lid-cap");
    // Too small a box for the minimum window: the whole frame (and the flush shrink) drops.
    const tiny = { ...defaults, cardCount: 40, capRail: 12 };
    expect(capSpec(tiny)).toBeNull();
    expect(dims(tiny).railStrip).toBeCloseTo(Math.max(1.5 * t, 5), 9);
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
      "lid-cap": [
        [(d.outerW - d.capW) / 2, 0, d.slotZ + t],
        [(d.outerW + d.capW) / 2, d.capL, d.slotZ + 2 * t],
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
