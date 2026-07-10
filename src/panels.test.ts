// Geometry tests for the ten finger-jointed panels: comb complementarity, kerf press-fit growth,
// outline sanity, assembled placement, and the retrieval cutouts. Pure Node — no DOM, no WASM.

import { bbox } from "parametric-kit/testkit";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, test } from "vite-plus/test";
import {
  applyPlace,
  combIntervals,
  fingerCount,
  type Panel,
  panels,
  placeMatrix,
  type Pt,
} from "./panels.ts";
import { defaults, dims, effectiveNotchDepth, type Params } from "./params.ts";

const d = dims(defaults);
const t = defaults.thickness;

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
    for (const len of [d.bodyH, d.innerW, d.capH]) {
      const n = fingerCount(len, defaults.fingerWidth);
      const a = combIntervals(len, n, true, 0).filter((iv) => iv.finger);
      const b = combIntervals(len, n, false, 0).filter((iv) => iv.finger);
      const all = [...a, ...b].sort((p, q) => p.a - q.a);
      expect(all[0]!.a).toBeCloseTo(0, 9);
      expect(all[all.length - 1]!.b).toBeCloseTo(len, 9);
      for (let i = 1; i < all.length; i++) expect(all[i]!.a).toBeCloseTo(all[i - 1]!.b, 9); // no gap, no overlap
    }
  });

  test("finger count is odd, >= 3, and keeps segments near the target width", () => {
    const n = fingerCount(100, 10);
    expect(n % 2).toBe(1);
    expect(100 / n).toBeGreaterThanOrEqual(6);
    expect(fingerCount(5, 10)).toBe(3); // floor for tiny edges
  });

  test("kerf grows interior fingers by k, end fingers by k/2, and shrinks slots to match", () => {
    const k = 0.2;
    const n = fingerCount(d.bodyH, defaults.fingerWidth);
    const plain = combIntervals(d.bodyH, n, true, 0);
    const comp = combIntervals(d.bodyH, n, true, k);
    for (let i = 0; i < n; i++) {
      const dLen = comp[i]!.b - comp[i]!.a - (plain[i]!.b - plain[i]!.a);
      const ends = (i === 0 ? 1 : 0) + (i === n - 1 ? 1 : 0);
      const expected = (plain[i]!.finger ? 1 : -1) * (k - (ends * k) / 2);
      expect(dLen).toBeCloseTo(expected, 9);
    }
  });
});

describe("outlines", () => {
  const ids = [
    "body-front",
    "body-back",
    "body-left",
    "body-right",
    "body-floor",
    "cap-front",
    "cap-back",
    "cap-left",
    "cap-right",
    "cap-top",
  ];

  test("all ten panels exist, CCW, deduped, inside their declared size", () => {
    const all = panels(defaults);
    expect(all.map((p) => p.id)).toEqual(ids);
    for (const p of all) {
      expect(p.outline.length).toBeGreaterThanOrEqual(4);
      expect(signedArea(p.outline)).toBeGreaterThan(0);
      for (let i = 0; i < p.outline.length; i++) {
        const [x1, y1] = p.outline[i]!;
        const [x2, y2] = p.outline[(i + 1) % p.outline.length]!;
        expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThan(1e-9); // no dup points incl. closure
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

  test("vertical corners: wide wall has material where the narrow wall doesn't, and vice versa", () => {
    const p0 = { ...defaults, kerf: 0 };
    const front = panel("body-front", p0);
    const left = panel("body-left", p0);
    const n = fingerCount(d.bodyH, defaults.fingerWidth);
    const seg = d.bodyH / n;
    // Segment 0 (bottom): wide-wall finger. Probe the corner column's midline.
    expect(inPoly(front.outline, t / 2, seg / 2)).toBe(true);
    expect(inPoly(left.outline, t / 2, seg / 2)).toBe(false);
    // Segment 1: narrow-wall finger.
    expect(inPoly(front.outline, t / 2, 1.5 * seg)).toBe(false);
    expect(inPoly(left.outline, t / 2, 1.5 * seg)).toBe(true);
  });

  test("floor tabs fill the wall's bottom notches", () => {
    const p0 = { ...defaults, kerf: 0 };
    const floor = panel("body-floor", p0);
    const front = panel("body-front", p0);
    const n = fingerCount(d.innerW, defaults.fingerWidth);
    const iv = combIntervals(d.innerW, n, false, 0);
    const tabMid = (iv[1]!.a + iv[1]!.b) / 2; // first tab (B-phase index 1)
    const gapMid = (iv[0]!.a + iv[0]!.b) / 2; // wall material between tabs
    // Floor: tab material reaches v=0 under the tab, not under the gap.
    expect(inPoly(floor.outline, t + tabMid, t / 2)).toBe(true);
    expect(inPoly(floor.outline, t + gapMid, t / 2)).toBe(false);
    // Wall: notch (no material) at the tab, material at the gap. Same x origin: inner span starts at t.
    expect(inPoly(front.outline, t + tabMid, t / 2)).toBe(false);
    expect(inPoly(front.outline, t + gapMid, t / 2)).toBe(true);
  });

  test("cap-top tabs fill the cap walls' top notches", () => {
    const p0 = { ...defaults, kerf: 0 };
    const top = panel("cap-top", p0);
    const capFront = panel("cap-front", p0);
    const n = fingerCount(d.capInnerW, defaults.fingerWidth);
    const iv = combIntervals(d.capInnerW, n, false, 0);
    const tabMid = (iv[1]!.a + iv[1]!.b) / 2;
    expect(inPoly(top.outline, t + tabMid, t / 2)).toBe(true);
    expect(inPoly(capFront.outline, t + tabMid, d.capH - t / 2)).toBe(false);
    const gapMid = (iv[0]!.a + iv[0]!.b) / 2;
    expect(inPoly(capFront.outline, t + gapMid, d.capH - t / 2)).toBe(true);
  });
});

describe("retrieval cutouts", () => {
  test("thumb notch dips exactly effectiveNotchDepth into the front wall's top edge", () => {
    const p = { ...defaults, notchWidth: 20 };
    const front = panel("body-front", p);
    const depth = effectiveNotchDepth(p);
    const cx = d.bodyOuterW / 2;
    expect(inPoly(front.outline, cx, d.bodyH - depth - 0.2)).toBe(true);
    expect(inPoly(front.outline, cx, d.bodyH - depth + 0.2)).toBe(false);
    // Notch depth never exceeds the cap skirt, so the closed cap hides it.
    expect(depth).toBeLessThanOrEqual(p.capDepth);
    // Off → flat top edge.
    const flat = panel("body-front", { ...defaults, notchWidth: 0 });
    expect(inPoly(flat.outline, cx, d.bodyH - 0.1)).toBe(true);
    // Other walls stay flat.
    expect(inPoly(panel("body-back", p).outline, cx, d.bodyH - 0.1)).toBe(true);
  });

  test("side recesses dip into both narrow walls when enabled", () => {
    const p = { ...defaults, sideRecessWidth: 18 };
    const depth = Math.min(18 / 2, p.capDepth);
    for (const id of ["body-left", "body-right"]) {
      const w = panel(id, p);
      expect(inPoly(w.outline, d.bodyOuterD / 2, d.bodyH - depth + 0.2)).toBe(false);
      expect(inPoly(w.outline, d.bodyOuterD / 2, d.bodyH - depth - 0.2)).toBe(true);
      const off = panel(id, defaults); // default sideRecessWidth = 0
      expect(inPoly(off.outline, d.bodyOuterD / 2, d.bodyH - 0.1)).toBe(true);
    }
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

  test("each panel occupies exactly its slab; body and cap unions match dims", () => {
    const all = panels(defaults);
    const co = -(t + defaults.capFit);
    const expected: Record<string, number[][]> = {
      "body-front": [
        [0, 0, 0],
        [d.bodyOuterW, t, d.bodyH],
      ],
      "body-back": [
        [0, d.bodyOuterD - t, 0],
        [d.bodyOuterW, d.bodyOuterD, d.bodyH],
      ],
      "body-left": [
        [0, 0, 0],
        [t, d.bodyOuterD, d.bodyH],
      ],
      "body-right": [
        [d.bodyOuterW - t, 0, 0],
        [d.bodyOuterW, d.bodyOuterD, d.bodyH],
      ],
      "body-floor": [
        [0, 0, 0],
        [d.bodyOuterW, d.bodyOuterD, t],
      ],
      "cap-front": [
        [co, co, d.bodyH - defaults.capDepth],
        [co + d.capOuterW, co + t, d.assembledH],
      ],
      "cap-top": [
        [co, co, d.assembledH - t],
        [co + d.capOuterW, co + d.capOuterD, d.assembledH],
      ],
    };
    for (const p of all) {
      const box = worldBox(p);
      const exp = expected[p.id];
      if (!exp) continue;
      for (let a = 0; a < 3; a++) {
        expect(box.min[a]).toBeCloseTo(exp[0]![a]!, 6);
        expect(box.max[a]).toBeCloseTo(exp[1]![a]!, 6);
      }
    }
    // Unions.
    const union = (ps: Panel[]) => {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const p of ps) {
        const b = worldBox(p);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a]!, b.min[a]!);
          max[a] = Math.max(max[a]!, b.max[a]!);
        }
      }
      return { min, max };
    };
    const body = union(all.filter((p) => p.id.startsWith("body-")));
    expect(body.min[0]).toBeCloseTo(0, 6);
    expect(body.min[1]).toBeCloseTo(0, 6);
    expect(body.min[2]).toBeCloseTo(0, 6);
    expect(body.max[0]).toBeCloseTo(d.bodyOuterW, 6);
    expect(body.max[1]).toBeCloseTo(d.bodyOuterD, 6);
    expect(body.max[2]).toBeCloseTo(d.bodyH, 6);
    const cap = union(all.filter((p) => p.id.startsWith("cap-")));
    expect(cap.min[0]).toBeCloseTo(co, 6);
    expect(cap.max[0]).toBeCloseTo(co + d.capOuterW, 6);
    expect(cap.min[2]).toBeCloseTo(d.bodyH - defaults.capDepth, 6);
    expect(cap.max[2]).toBeCloseTo(d.assembledH, 6);
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
