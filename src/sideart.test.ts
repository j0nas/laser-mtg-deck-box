// Tests for the wall-engraving pattern engine (sideart.ts): joint-safe borders, thumb-notch
// routing, per-pattern presence, the mana monogram's whole-glyph rule, degradation, and the
// pass/coordinate contracts the SVG export and preview rely on. Loads the real bundled symbol
// glyphs. No DOM, no fetch.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { clipRings, flattenPathData, type Ring, ringsArea } from "./heal.ts";
import {
  type Bbox,
  DEFAULT_LID_ART,
  type LidArt,
  type LidFinish,
  SIDE_STYLES,
  type SideLayout,
  type SideStyle,
} from "./lidart.ts";
import { panels, thumbNotch } from "./panels.ts";
import { defaults, dims, type Params } from "./params.ts";
import { layoutSideArt, type WallArt, wallMargin } from "./sideart.ts";

const SYMBOLS = JSON.parse(
  readFileSync(fileURLToPath(new URL("./assets/mana-symbols.json", import.meta.url)), "utf8"),
) as Record<string, string>;

const PATTERNS: SideStyle[] = [
  "lattice",
  "chevron",
  "herringbone",
  "yabane",
  "basketweave",
  "meander",
  "sunburst",
  "ogee",
  "tatewaku",
  "guilloche",
  "starcross",
  "seigaiha",
  "asanoha",
  "kagome",
  "kikko",
  "shippo",
  "hitomezashi",
  "dunes",
  "mana",
];

const cfg = (over: Partial<LidArt> = {}): LidArt => ({
  ...DEFAULT_LID_ART,
  sides: "seigaiha",
  pips: ["W", "U", "B", "G"],
  symbolPaths: SYMBOLS,
  ...over,
});

const mk = (over: Partial<Params>): Params => ({ ...defaults, ...over });

const WALL_ORDER = ["body-front", "side-right-outer", "body-back", "side-left-outer"];

function wall(walls: WallArt[], id: string): WallArt {
  const found = walls.find((w) => w.panelId === id);
  if (!found) throw new Error(`no wall art for ${id}`);
  return found;
}

// Every path point of every element, panel-local mm (band and glyph paths are polygonal, so the
// flattening just parses them).
function points(wa: WallArt, ids?: string[]): [number, number][] {
  return wa.elements
    .filter((e) => !ids || ids.includes(e.id))
    .flatMap((e) => e.paths.flatMap((d) => flattenPathData(d, 0.05, undefined, 1, false)))
    .flat() as [number, number][];
}

// Distance from a point OUTSIDE the U-shaped notch cut to the cut's edge: the flank walls above
// the semicircle centre, the semicircle metric below it.
const distToNotch = (
  n: { cx: number; halfW: number; depth: number },
  h: number,
  x: number,
  y: number,
) => {
  const yc = h - n.depth + n.halfW;
  if (y >= yc) return Math.abs(x - n.cx) - n.halfW;
  return Math.hypot(x - n.cx, y - yc) - n.halfW;
};

describe("composition at Commander defaults", () => {
  test("every pattern decorates all four walls: border + pattern, all engrave, inside the blank", () => {
    for (const style of PATTERNS) {
      const walls = layoutSideArt(defaults, cfg({ sides: style }));
      expect(
        walls.map((w) => w.panelId),
        style,
      ).toEqual(WALL_ORDER);
      for (const wa of walls) {
        expect(
          wa.elements.map((e) => e.id),
          `${style}/${wa.panelId}`,
        ).toEqual(["border", "pattern"]);
        for (const el of wa.elements) {
          expect(el.pass, `${style}/${wa.panelId}/${el.id}`).toBe("engrave");
          expect(el.bbox.x0).toBeGreaterThanOrEqual(-1e-6);
          expect(el.bbox.y0).toBeGreaterThanOrEqual(-1e-6);
          expect(el.bbox.x1).toBeLessThanOrEqual(wa.w + 1e-6);
          expect(el.bbox.y1).toBeLessThanOrEqual(wa.h + 1e-6);
        }
      }
    }
  });

  test("wall sizes and art faces match the panels: back is the one flipped at assembly", () => {
    const walls = layoutSideArt(defaults, cfg());
    const d = dims(defaults);
    expect(wall(walls, "body-front")).toMatchObject({ w: d.outerW, h: d.slotZ, artFace: "top" });
    expect(wall(walls, "body-back")).toMatchObject({ w: d.outerW, h: d.wallH, artFace: "bottom" });
    expect(wall(walls, "side-left-outer")).toMatchObject({
      w: d.outerD,
      h: d.wallH,
      artFace: "top",
    });
    expect(wall(walls, "side-right-outer")).toMatchObject({
      w: d.outerD,
      h: d.wallH,
      artFace: "top",
    });
  });

  test("the border rides one uniform margin inside every panel edge", () => {
    const M = wallMargin(defaults.thickness);
    for (const wa of layoutSideArt(defaults, cfg())) {
      const b = wa.elements.find((e) => e.id === "border")!.bbox;
      expect(b.x0).toBeCloseTo(M, 4);
      expect(b.x1).toBeCloseTo(wa.w - M, 4);
      expect(b.y0).toBeCloseTo(M, 4);
      // The top may dip around a notch, but never rises above the margin line.
      expect(b.y1).toBeLessThanOrEqual(wa.h - M + 1e-6);
    }
  });

  test("every pattern keeps its air gap inside the border", () => {
    const M = wallMargin(defaults.thickness);
    const inset = 2.25; // BORDER_W + FIELD_GAP, minus float slack
    for (const style of PATTERNS) {
      for (const wa of layoutSideArt(defaults, cfg({ sides: style }))) {
        const p = wa.elements.find((e) => e.id === "pattern")!.bbox;
        expect(p.x0, `${style}/${wa.panelId}`).toBeGreaterThanOrEqual(M + inset);
        expect(p.x1).toBeLessThanOrEqual(wa.w - M - inset);
        expect(p.y0).toBeGreaterThanOrEqual(M + inset);
        expect(p.y1).toBeLessThanOrEqual(wa.h - M - inset);
      }
    }
  });
});

describe("thumb-notch routing", () => {
  const notch = thumbNotch(defaults)!;
  const H = dims(defaults).slotZ;

  test("no engraved point enters the keep-out; the border dips under the cut", () => {
    for (const style of ["lattice", "chevron", "seigaiha", "shippo", "mana"] as const) {
      const front = wall(layoutSideArt(defaults, cfg({ sides: style })), "body-front");
      let dipped = 0;
      for (const [x, y] of points(front, ["border"])) {
        expect(
          distToNotch(notch, H, x, y),
          `${style} (${x.toFixed(2)}, ${y.toFixed(2)})`,
        ).toBeGreaterThanOrEqual(1.3 - 0.05);
        if (distToNotch(notch, H, x, y) < 1.3 + 1.5 && y < H - notch.depth) dipped++;
      }
      expect(dipped, style).toBeGreaterThan(4); // the routed band really passes under the notch
      // The pattern stays further out: border width + field gap beyond the border's clearance.
      for (const [x, y] of points(front, ["pattern"])) {
        expect(
          distToNotch(notch, H, x, y),
          `${style} (${x.toFixed(2)}, ${y.toFixed(2)})`,
        ).toBeGreaterThanOrEqual(3.6 - 0.1);
      }
    }
  });

  test("a back notch routes the back wall; the front's top rail runs straight", () => {
    const p = mk({ notchWalls: "back" as const });
    const dd = dims(p);
    const bn = thumbNotch(p)!;
    const backNotch = { ...bn, depth: bn.depth + (dd.wallH - dd.slotZ) }; // the deepened back cut
    const back = wall(layoutSideArt(p, cfg()), "body-back");
    for (const [x, y] of points(back, ["border"])) {
      expect(distToNotch(backNotch, dd.wallH, x, y)).toBeGreaterThanOrEqual(1.3 - 0.05);
    }
    const frontBorder = wall(layoutSideArt(p, cfg()), "body-front").elements.find(
      (e) => e.id === "border",
    )!;
    expect(frontBorder.bbox.y1).toBeCloseTo(dd.slotZ - wallMargin(p.thickness), 4);
  });
});

describe("full-bleed layout", () => {
  const full = (over: Partial<LidArt> = {}): LidArt => cfg({ sideLayout: "full", ...over });

  test("no border: the pattern alone, bled past the framed margin, still inside the blank", () => {
    const M = wallMargin(defaults.thickness);
    for (const style of PATTERNS) {
      const walls = layoutSideArt(defaults, full({ sides: style }));
      expect(
        walls.map((w) => w.panelId),
        style,
      ).toEqual(WALL_ORDER);
      for (const wa of walls) {
        expect(
          wa.elements.map((e) => e.id),
          `${style}/${wa.panelId}`,
        ).toEqual(["pattern"]);
        const b = wa.elements[0]!.bbox;
        expect(b.x0, `${style}/${wa.panelId}`).toBeGreaterThanOrEqual(-1e-6);
        expect(b.y0).toBeGreaterThanOrEqual(-1e-6);
        expect(b.x1).toBeLessThanOrEqual(wa.w + 1e-6);
        expect(b.y1).toBeLessThanOrEqual(wa.h + 1e-6);
        if (style !== "mana") {
          // Continuous linework really bleeds: past the framed border's reach on all four sides.
          expect(b.x0, `${style}/${wa.panelId}`).toBeLessThan(M);
          expect(b.y0).toBeLessThan(M);
          expect(b.x1).toBeGreaterThan(wa.w - M);
          expect(b.y1).toBeGreaterThan(wa.h - M);
        }
      }
    }
  });

  test("every band lands on panel material: nothing on comb recesses, notch cut or off the blank", () => {
    const outlineById = new Map(panels(defaults).map((pn) => [pn.id, pn.outline as Ring]));
    for (const style of ["lattice", "seigaiha", "asanoha", "kikko", "shippo", "ogee"] as const) {
      for (const wa of layoutSideArt(defaults, full({ sides: style }))) {
        const rings = wa.elements.flatMap((e) =>
          e.paths.flatMap((d) => flattenPathData(d, 0.05, undefined, 1, false)),
        ) as Ring[];
        const stray = clipRings("difference", rings, [outlineById.get(wa.panelId)!]);
        expect(Math.abs(ringsArea(stray)), `${style}/${wa.panelId}`).toBeLessThan(0.05);
      }
    }
  });

  test("the pattern runs right up to the thumb cut but never into it", () => {
    const notch = thumbNotch(defaults)!;
    const H = dims(defaults).slotZ;
    const front = wall(layoutSideArt(defaults, full({ sides: "lattice" })), "body-front");
    let nearCut = 0;
    for (const [x, y] of points(front)) {
      const dist = distToNotch(notch, H, x, y);
      expect(dist, `(${x.toFixed(2)}, ${y.toFixed(2)})`).toBeGreaterThanOrEqual(-0.1);
      if (dist < 1.25) nearCut++; // inside the clearance the framed layout would keep
    }
    expect(nearCut).toBeGreaterThan(0);
  });

  test("mana: the grid grows to the joint-safe interior, whole glyphs only, clear of the notch", () => {
    const t = defaults.thickness;
    const notch = thumbNotch(defaults)!;
    const H = dims(defaults).slotZ;
    for (const wa of layoutSideArt(defaults, full({ sides: "mana" }))) {
      const framed = wall(layoutSideArt(defaults, cfg({ sides: "mana" })), wa.panelId);
      const p = wa.elements[0]!;
      expect(p.paths.length, wa.panelId).toBeGreaterThanOrEqual(
        framed.elements.find((e) => e.id === "pattern")!.paths.length,
      );
      expect(p.bbox.x0).toBeGreaterThanOrEqual(2 * t - 1e-6);
      expect(p.bbox.y0).toBeGreaterThanOrEqual(2 * t - 1e-6);
      expect(p.bbox.x1).toBeLessThanOrEqual(wa.w - 2 * t + 1e-6);
      expect(p.bbox.y1).toBeLessThanOrEqual(wa.h - 2 * t + 1e-6);
    }
    for (const [x, y] of points(
      wall(layoutSideArt(defaults, full({ sides: "mana" })), "body-front"),
    )) {
      expect(
        distToNotch(notch, H, x, y),
        `(${x.toFixed(2)}, ${y.toFixed(2)})`,
      ).toBeGreaterThanOrEqual(1.3 - 0.05);
    }
  });
});

describe("styles and degradation", () => {
  test("'none' -> no wall art at all", () => {
    expect(layoutSideArt(defaults, cfg({ sides: "none" }))).toEqual([]);
  });

  test("mana: whole glyphs tile every wall, several per wall", () => {
    for (const wa of layoutSideArt(defaults, cfg({ sides: "mana" }))) {
      const pattern = wa.elements.find((e) => e.id === "pattern")!;
      expect(pattern.paths.length, wa.panelId).toBeGreaterThanOrEqual(6);
    }
  });

  test("mana without an identity or without glyph data keeps the border alone", () => {
    for (const over of [{ pips: [] }, { symbolPaths: {} }]) {
      const walls = layoutSideArt(defaults, cfg({ sides: "mana", ...over }));
      expect(walls.length).toBe(4);
      for (const wa of walls) expect(wa.elements.map((e) => e.id)).toEqual(["border"]);
    }
  });

  test("tiny walls degrade gracefully: art shrinks or drops, nothing ever leaves its blank", () => {
    for (const style of PATTERNS) {
      for (const cardCount of [40, 20, 10]) {
        const p = mk({ cardCount, extraCards: 0, cardThickness: 0.305, cardWidth: 63.5 });
        for (const sideLayout of ["framed", "full"] as const) {
          for (const wa of layoutSideArt(p, cfg({ sides: style, sideLayout }))) {
            for (const el of wa.elements) {
              const b: Bbox = el.bbox;
              expect(
                b.x0,
                `${style}/${sideLayout}/${cardCount}/${wa.panelId}`,
              ).toBeGreaterThanOrEqual(-1e-6);
              expect(b.y0).toBeGreaterThanOrEqual(-1e-6);
              expect(b.x1).toBeLessThanOrEqual(wa.w + 1e-6);
              expect(b.y1).toBeLessThanOrEqual(wa.h + 1e-6);
            }
          }
        }
      }
    }
  });
});

// The control panel's <select> lists are hand-written in index.html while the model's unions live
// in lidart.ts, and this file keeps a third copy in PATTERNS. A value added to one and not the
// others is silently unreachable — sanitizeLidArt maps an unknown style to "none" and an unknown
// finish to "foil", so nothing throws and the option simply does nothing. Pin the copies together.
describe("the control panel's option lists stay in step with the model", () => {
  const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
  const options = (id: string): string[] => {
    const sel = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html);
    if (!sel) throw new Error(`no <select id="${id}"> in index.html`);
    return [...sel[1]!.matchAll(/value="([^"]*)"/g)].map((m) => m[1]!);
  };

  test("PATTERNS is exactly SIDE_STYLES minus 'none'", () => {
    expect(["none", ...PATTERNS]).toEqual([...SIDE_STYLES]);
  });

  test("every side pattern is selectable, and every option is a real style", () => {
    expect(options("laSides")).toEqual([...SIDE_STYLES]);
  });

  test("every lid finish and pattern layout is selectable", () => {
    const finishes: LidFinish[] = ["foil", "engraved", "pierced"];
    const layouts: SideLayout[] = ["framed", "full"];
    expect(options("laFinish")).toEqual(finishes);
    expect(options("laSideLayout")).toEqual(layouts);
  });
});
