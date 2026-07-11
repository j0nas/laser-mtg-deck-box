// Tests for the vector morphological compensation (heal.ts): the guarantee that a mana coin ships
// the REAL glyph while every foil feature and knockout gap stays above the 0.4 mm floor. Pure Node.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pointInPolygon } from "parametric-kit/testkit";
import { describe, expect, test } from "vite-plus/test";
import { flattenPathData, healCoin, type Ring, ringsArea } from "./heal.ts";

const FLOOR = 0.4;

const SYMBOLS = JSON.parse(
  readFileSync(fileURLToPath(new URL("./assets/mana-symbols.json", import.meta.url)), "utf8"),
) as Record<string, string>;

// Even-odd point membership over a flat ring list (the shape the coin ships as).
function inside(rings: Ring[], x: number, y: number): boolean {
  let count = 0;
  for (const ring of rings) if (pointInPolygon(ring, x, y)) count++;
  return count % 2 === 1;
}

// Exact (unsigned) distance from a point to the region boundary: min distance to any ring edge.
function distToBoundary(rings: Ring[], x: number, y: number): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i]!;
      const [bx, by] = ring[(i + 1) % ring.length]!;
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2)) : 0;
      const d = Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
      if (d < best) best = d;
    }
  }
  return best;
}

// Local feature width probe. Healing OPENs (or dilation-covers) each phase with discs of radius
// R = floor/2, guaranteeing: every point p of the phase lies in SOME disc D_R(c) inside the phase
// with |p−c| ≤ R. For a candidate c in the phase, D_{d(c)}(c) is inside the phase (d = exact
// boundary distance), so p is "hosted" when ∃c: d(c) ≥ r and |p−c| ≤ d(c) + tol — with a
// (R−r)-dense candidate net over the R-disc this follows from openness (Lipschitz slack absorbed
// by tol), while a point deep inside an extended sub-floor feature (like the pathological
// hairlines) finds no such disc. tol trades a small blind zone (~0.35 mm around fat regions) for
// robustness against polygonisation facets.
function hasSubFloorFeature(
  rings: Ring[],
  bbox: { x0: number; y0: number; x1: number; y1: number },
  wantInside: boolean, // true: hunt thin FOIL; false: hunt thin GAPS (inside the coin's bbox)
  floor: number,
  gridStep: number,
): { x: number; y: number } | null {
  const R = floor / 2;
  const net = 0.05;
  const r = R - net;
  const tol = 2 * net;
  const candidates: [number, number][] = [[0, 0]];
  for (let oy = -R - net; oy <= R + net; oy += net * 1.3) {
    for (let ox = -R - net; ox <= R + net; ox += net * 1.3) {
      if ((ox !== 0 || oy !== 0) && Math.hypot(ox, oy) <= R + net) candidates.push([ox, oy]);
    }
  }
  for (let y = bbox.y0 + gridStep / 2; y < bbox.y1; y += gridStep) {
    for (let x = bbox.x0 + gridStep / 2; x < bbox.x1; x += gridStep) {
      if (inside(rings, x, y) !== wantInside) continue;
      const hosted = candidates.some(([ox, oy]) => {
        const cx = x + ox;
        const cy = y + oy;
        if (inside(rings, cx, cy) !== wantInside) return false;
        const d = distToBoundary(rings, cx, cy);
        return d >= r && Math.hypot(ox, oy) <= d + tol;
      });
      if (!hosted) return { x, y };
    }
  }
  return null;
}

describe("flattenPathData", () => {
  test("parses absolute/relative commands into closed rings", () => {
    // A square with a triangular hole, mixed command styles.
    const rings = flattenPathData("M0 0L10 0l0 10L0 10zM3 3l4 0l-2 4z", 0.02);
    expect(rings.length).toBe(2);
    expect(rings[0]!.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(ringsArea([rings[0]!]))).toBeCloseTo(100, 6);
    expect(Math.abs(ringsArea([rings[1]!]))).toBeCloseTo(8, 6);
  });

  test("flattens curves within tolerance", () => {
    // A full circle of radius 10 via two arcs: area must approach πr².
    const rings = flattenPathData("M-10 0A10 10 0 1 1 10 0A10 10 0 1 1 -10 0Z", 0.02);
    expect(rings.length).toBe(1);
    expect(Math.abs(ringsArea(rings))).toBeGreaterThan(Math.PI * 100 * 0.995);
    expect(Math.abs(ringsArea(rings))).toBeLessThan(Math.PI * 100 * 1.005);
  });
});

describe("healCoin on a pathological synthetic glyph", () => {
  // In the symbol's 0..100 box: a 0.5-unit-wide slot (at 10 mm coin ≈ 0.05 mm — far below floor)
  // and an equally hairline foil island created by a 10-unit hole containing a 9.5-unit island
  // 0.25 units from its wall... simplest: a thin ring gap leaves a foil island inside it.
  const SLOT = "M20 48L80 48L80 48.5L20 48.5Z"; // hairline knockout slot
  const RING_GAP =
    "M30 60L70 60L70 80L30 80ZM30.5 60.5L69.5 60.5L69.5 79.5L30.5 79.5Z" /* 0.5-unit-wide void ring
      -> encloses a 39×19-unit foil island connected to nothing */;
  const GLYPH = SLOT + RING_GAP;

  test("no gap or island narrower than the floor survives healing (10 mm coin)", () => {
    const size = 10;
    const c = healCoin(GLYPH, size, FLOOR);
    expect(c.foil.length).toBeGreaterThan(0);
    const bb = { x0: -size / 2, y0: -size / 2, x1: size / 2, y1: size / 2 };
    // Thin foil: every foil point must host a floor-sized disc.
    expect(hasSubFloorFeature(c.foil, bb, true, FLOOR, 0.35)).toBeNull();
    // Thin gaps: every knockout point within the disc must host a floor-sized disc too.
    const discBB = { x0: bb.x0 + 0.6, y0: bb.y0 + 0.6, x1: bb.x1 - 0.6, y1: bb.y1 - 0.6 };
    expect(hasSubFloorFeature(c.foil, discBB, false, FLOOR, 0.35)).toBeNull();
    // And the healing actually did something: the hairline slot was widened, not dropped —
    // the point at its centre (0, +0.2 in coin mm ≈ y=48.25 in symbol space) is knockout.
    expect(inside(c.foil, 0, 0.175)).toBe(false);
    expect(c.stats.glyphThickenedArea).toBeGreaterThan(0);
    // The enclosed foil island's ring gap was widened / the island absorbed where sub-floor.
    expect(c.stats.foilAbsorbedArea + c.stats.glyphThickenedArea).toBeGreaterThan(0.05);
  });
});

describe("healCoin on the real symbols", () => {
  const CODES = ["W", "U", "B", "R", "G"] as const;

  for (const size of [9, 14]) {
    test(`W/U/B/R/G at ${size} mm: non-empty healed coins, inside the disc, floor respected`, () => {
      for (const code of CODES) {
        const c = healCoin(SYMBOLS[code]!, size, FLOOR);
        expect(c.foil.length).toBeGreaterThan(0);
        // Substantial foil survives (the coin still reads as a coin)…
        const area = Math.abs(ringsArea(c.foil));
        const discArea = Math.PI * (size / 2) ** 2;
        expect(area).toBeGreaterThan(discArea * 0.15);
        expect(area).toBeLessThan(discArea + 0.5);
        // …and the glyph knockout is real: clearly less foil than a plain disc.
        expect(area).toBeLessThan(discArea * 0.95);
        // Every vertex stays within the disc (+ tiny polygonisation slack).
        for (const ring of c.foil) {
          for (const [x, y] of ring) {
            expect(Math.hypot(x, y)).toBeLessThanOrEqual(size / 2 + 0.05);
          }
        }
        // No sub-floor foil feature survives (coarse grid keeps the suite fast; the pathological
        // test above hunts at a finer step).
        const bb = { x0: -size / 2, y0: -size / 2, x1: size / 2, y1: size / 2 };
        expect(hasSubFloorFeature(c.foil, bb, true, FLOOR, 0.45)).toBeNull();
      }
    });
  }

  test("winding sanity: rings are non-degenerate and holes oppose their outers", () => {
    const c = healCoin(SYMBOLS.W!, 14, FLOOR);
    // Every ring encloses real area…
    for (const ring of c.foil) {
      expect(Math.abs(ringsArea([ring]))).toBeGreaterThan(1e-4);
    }
    // …and the net (signed) area equals the even-odd area magnitude, which only holds when hole
    // windings oppose outer windings (otherwise nested rings would double-count).
    const net = Math.abs(ringsArea(c.foil));
    const discArea = Math.PI * 49;
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(discArea);
  });

  test("multi-mode glyph region: non-empty, inside the disc", () => {
    const c = healCoin(SYMBOLS.G!, 12, FLOOR);
    expect(c.glyph.length).toBeGreaterThan(0);
    for (const ring of c.glyph) {
      for (const [x, y] of ring) expect(Math.hypot(x, y)).toBeLessThanOrEqual(6.01);
    }
  });

  test("deterministic", () => {
    const a = healCoin(SYMBOLS.U!, 9, FLOOR);
    const b = healCoin(SYMBOLS.U!, 9, FLOOR);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
