// Tests for the pure lid-marque layout engine (all-vector composition). Loads the bundled display
// font and the real Scryfall symbol glyphs from disk (the same assets the browser uses). No DOM,
// no fetch.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";
import { describe, expect, test } from "vite-plus/test";
import { flattenPathData, ringsArea } from "./heal.ts";
import {
  type Bbox,
  DEFAULT_LID_ART,
  HOLE_CLEAR,
  type LidArt,
  layoutLidArt,
  PIP_MIN_D,
  PIP_UNIFORM_D,
  pipBaseD,
  sanitizeLidArt,
  sortPips,
  splitName,
  visibleZone,
} from "./lidart.ts";
import { capSpec, pullHole } from "./panels.ts";
import { defaults, dims, type Params } from "./params.ts";

const fontBuf = readFileSync(fileURLToPath(new URL("./assets/Cinzel-Bold.ttf", import.meta.url)));
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength),
);

const SYMBOLS = JSON.parse(
  readFileSync(fileURLToPath(new URL("./assets/mana-symbols.json", import.meta.url)), "utf8"),
) as Record<string, string>;

const enabled = (over: Partial<LidArt> = {}): LidArt => ({
  ...DEFAULT_LID_ART,
  enabled: true,
  name: "Atraxa, Praetors' Voice",
  pips: ["W", "U", "B", "G"],
  symbolPaths: SYMBOLS,
  ...over,
});

const mk = (over: Partial<Params>): Params => ({ ...defaults, ...over });

function inside(b: Bbox, vz: Bbox): boolean {
  return (
    b.x0 >= vz.x0 - 1e-6 && b.y0 >= vz.y0 - 1e-6 && b.x1 <= vz.x1 + 1e-6 && b.y1 <= vz.y1 + 1e-6
  );
}

// Nearest distance from a bbox to a point (0 if the point is inside the bbox).
function bboxToPoint(b: Bbox, px: number, py: number): number {
  const dx = Math.max(b.x0 - px, 0, px - b.x1);
  const dy = Math.max(b.y0 - py, 0, py - b.y1);
  return Math.hypot(dx, dy);
}

// Elements that legitimately encircle the pull hole (their bbox contains it, but their filled
// band stays clear); every other element must keep its whole bbox out of the keep-out.
const ENCIRCLES_HOLE = new Set(["border", "frame-trace"]);

// The frame trace is the glue-peel guide: it deliberately hugs the window cut in the margin band
// OUTSIDE the marque zone, so it is exempt from the zone-confinement assertions (it gets its own
// window-hugging assertions instead).
const zoneConfined = (id: string) => id !== "frame-trace";

describe("splitName", () => {
  test("splits at the first comma and strips it", () => {
    expect(splitName("Atraxa, Praetors' Voice")).toEqual({
      primary: "Atraxa",
      epithet: "Praetors' Voice",
    });
    expect(splitName("Kenrith, the Returned King")).toEqual({
      primary: "Kenrith",
      epithet: "the Returned King",
    });
  });
  test("no comma -> single line; empty epithet -> single line", () => {
    expect(splitName("Krenko")).toEqual({ primary: "Krenko", epithet: null });
    expect(splitName("Krenko,")).toEqual({ primary: "Krenko", epithet: null });
    expect(splitName("  Krenko  ")).toEqual({ primary: "Krenko", epithet: null });
  });
  test("comma-less 'X the Y' title splits at ' the ', keeping 'the' on the small line", () => {
    expect(splitName("Zedruu the Greathearted")).toEqual({
      primary: "Zedruu",
      epithet: "the Greathearted",
    });
    expect(splitName("Isu the Abominable")).toEqual({
      primary: "Isu",
      epithet: "the Abominable",
    });
  });
  test("a name that merely starts with 'The' stays one line", () => {
    expect(splitName("The Ur-Dragon")).toEqual({ primary: "The Ur-Dragon", epithet: null });
    expect(splitName("The Mimeoplasm")).toEqual({ primary: "The Mimeoplasm", epithet: null });
  });
  test("a comma wins over an interior ' the '", () => {
    expect(splitName("Marisi, Breaker of the Coil")).toEqual({
      primary: "Marisi",
      epithet: "Breaker of the Coil",
    });
  });
});

describe("composition at Commander defaults", () => {
  const els = layoutLidArt(defaults, enabled(), { font });
  const ids = els.map((e) => e.id);

  test("all elements present: crown, split name, rules and four coins; no stamp ring — and NO pinstripe border, the lid frame's window edge replaces it", () => {
    expect(ids).not.toContain("stamp");
    expect(ids).not.toContain("border");
    expect(ids).toContain("crown");
    expect(ids).toContain("name");
    expect(ids).toContain("epithet");
    expect(ids).toContain("name-rules");
    for (let i = 0; i < 4; i++) expect(ids).toContain(`pip-${i}`);
  });

  test("with the lid frame off, the foil pinstripe border returns", () => {
    const bare = layoutLidArt(mk({ capRail: 0 }), enabled(), { font });
    expect(bare.map((e) => e.id)).toContain("border");
  });

  test("everything but the frame trace sits inside the visible zone", () => {
    const vz = visibleZone(defaults);
    for (const el of els) {
      if (zoneConfined(el.id)) expect(inside(el.bbox, vz), el.id).toBe(true);
    }
  });

  test("frame trace: a thin band whose outer boundary is exactly the window cut", () => {
    const trace = els.find((e) => e.id === "frame-trace")!;
    expect(trace.pass).toBe("foilGold");
    expect(trace.paths.length).toBeGreaterThanOrEqual(2); // outer silhouette + inset ring(s)
    const cap = capSpec(defaults)!;
    const d = dims(defaults);
    const xoff = (d.lidW - cap.w) / 2;
    // Bbox spans the window plus its ornaments: scallop below the front edge, arch above the back.
    expect(trace.bbox.x0).toBeCloseTo(xoff + cap.window.x0, 6);
    expect(trace.bbox.x1).toBeCloseTo(xoff + cap.window.x1, 6);
    expect(trace.bbox.y0).toBeCloseTo(cap.window.y0 - cap.scallop!.depth, 6);
    expect(trace.bbox.y1).toBeCloseTo(cap.window.y1 + cap.arch!.h + cap.arch!.tip, 6);
    // The band hugs the edge: it never reaches the marque zone.
    const vz = visibleZone(defaults);
    const bandOuterAtLeft = xoff + cap.window.x0;
    expect(vz.x0 - bandOuterAtLeft).toBeGreaterThan(0.5); // zone margin exceeds the band width
    // Frame off -> no trace (the pinstripe border returns instead).
    const bare = layoutLidArt(mk({ capRail: 0 }), enabled(), { font });
    expect(bare.find((e) => e.id === "frame-trace")).toBeUndefined();
  });

  test("the primary is large (cap band near the 10 mm target plus the arch rise); epithet well below", () => {
    const name = els.find((e) => e.id === "name")!;
    const epithet = els.find((e) => e.id === "epithet")!;
    const nameH = name.bbox.y1 - name.bbox.y0;
    const epithetH = epithet.bbox.y1 - epithet.bbox.y0;
    // Taller than the flat 10 mm cap: the arch rise is in there too.
    expect(nameH).toBeGreaterThan(10.01);
    expect(nameH).toBeLessThanOrEqual(10.01 + 0.5 * 10.01); // rise capped at half the band
    expect(epithetH).toBeGreaterThan(1);
    expect(epithetH).toBeLessThan(11 * 0.6);
    // Epithet reads beneath the primary.
    expect(epithet.bbox.y1).toBeLessThan(name.bbox.y0 + 1e-6);
  });

  test("the primary is arched: its apex rides well above its ends, symmetric about the centre", () => {
    const name = els.find((e) => e.id === "name")!;
    const cx = (name.bbox.x0 + name.bbox.x1) / 2;
    const halfW = (name.bbox.x1 - name.bbox.x0) / 2;
    const pts = name.paths.flatMap((d) => flattenPathData(d, 0.05, undefined, 1, false)).flat();
    const topAt = (lo: number, hi: number) =>
      Math.max(
        ...pts
          .filter(([x]) => Math.abs(x - cx) >= lo * halfW && Math.abs(x - cx) <= hi * halfW)
          .map(([, y]) => y),
      );
    const apex = topAt(0, 0.3);
    const ends = topAt(0.7, 1);
    expect(apex - ends).toBeGreaterThan(1); // a real arch, not jitter
    // Symmetric: the two end caps top out at about the same height.
    const left = Math.max(...pts.filter(([x]) => x < cx - 0.7 * halfW).map(([, y]) => y));
    const right = Math.max(...pts.filter(([x]) => x > cx + 0.7 * halfW).map(([, y]) => y));
    expect(Math.abs(left - right)).toBeLessThan(0.6);
  });

  test("the rules give the name block air: ≥1.5 mm between rule and text, both rules straight", () => {
    const name = els.find((e) => e.id === "name")!;
    const epithet = els.find((e) => e.id === "epithet")!;
    const rules = els.find((e) => e.id === "name-rules")!;
    // Top rule sits RULE_MARGIN (2.2) above the name's arch apex -> air = margin - rule weight.
    expect(rules.bbox.y1 - name.bbox.y1).toBeGreaterThanOrEqual(2.2 - 1e-6);
    // Bottom rule (MIN_FOIL thick) keeps the same air under the epithet.
    expect(epithet.bbox.y0 - (rules.bbox.y0 + 0.4)).toBeGreaterThanOrEqual(1.5);
    // Both rules are straight, MIN_FOIL-thick bars: each path spans exactly its own thickness.
    for (const bar of rules.paths) {
      const ys = flattenPathData(bar, 0.05, undefined, 1, false)
        .flat()
        .map(([, y]) => y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.4, 6);
    }
  });

  test("crown subpaths all wind the same way (nonzero: an opposite-wound overlap punches a hole)", () => {
    const crown = els.find((e) => e.id === "crown")!;
    expect(crown.fillRule).toBe("nonzero");
    // Identity transform, so no arc-sweep mirroring (flipY false).
    const signs = crown.paths.map((d) =>
      Math.sign(ringsArea(flattenPathData(d, 0.02, undefined, 1, false))),
    );
    expect(signs.length).toBe(5); // gem, two ribbons, two end dots
    for (const s of signs) expect(s).toBe(signs[0]);
  });

  test("only the border touches the pull-hole keep-out; no stamp ring is emitted", () => {
    const hole = pullHole(defaults)!;
    const clear = hole.r + HOLE_CLEAR;
    expect(els.find((e) => e.id === "stamp")).toBeUndefined();
    for (const el of els) {
      if (ENCIRCLES_HOLE.has(el.id)) continue;
      if (el.id.startsWith("pip-")) {
        // A coin's filled region is its disc; the square bbox corner may poke nearer, but the disc
        // itself stays outside the keep-out.
        const cx = (el.bbox.x0 + el.bbox.x1) / 2;
        const cy = (el.bbox.y0 + el.bbox.y1) / 2;
        const r = (el.bbox.x1 - el.bbox.x0) / 2;
        expect(Math.hypot(cx - hole.cx, cy - hole.cy) - r).toBeGreaterThanOrEqual(clear - 1e-6);
      } else {
        expect(bboxToPoint(el.bbox, hole.cx, hole.cy)).toBeGreaterThanOrEqual(clear - 1e-6);
      }
    }
  });

  test("mana orbit: coins arc above the pull hole, non-overlapping, clear of the hole keep-out", () => {
    const hole = pullHole(defaults)!;
    const keepR = hole.r + HOLE_CLEAR;
    const pips = els.filter((e) => e.id.startsWith("pip-"));
    expect(pips.length).toBe(4);
    const centers = pips.map((e) => ({
      x: (e.bbox.x0 + e.bbox.x1) / 2,
      y: (e.bbox.y0 + e.bbox.y1) / 2,
      d: e.bbox.x1 - e.bbox.x0,
    }));
    for (const c of centers) {
      expect(c.y).toBeGreaterThanOrEqual(hole.cy - 1e-6); // upper half of the orbit only
      expect(c.d).toBeGreaterThanOrEqual(PIP_MIN_D - 1e-6);
      expect(c.d).toBeLessThanOrEqual(pipBaseD(4) + 1e-6);
      // Clears the pull-hole keep-out: the coin's nearest point stays outside hole.r + HOLE_CLEAR.
      expect(Math.hypot(c.x - hole.cx, c.y - hole.cy) - c.d / 2).toBeGreaterThanOrEqual(
        keepR - 1e-6,
      );
    }
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const a = centers[i]!;
        const b = centers[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.d - 1e-6);
      }
    }
    // The topmost coin sits above the pull hole (it orbits it).
    expect(Math.max(...centers.map((c) => c.y))).toBeGreaterThan(hole.cy + hole.r);
  });

  test("single mode ships the healed knockout coin; multi splits disc + engrave glyph", () => {
    // Single: one element per coin, its path a healed multi-ring region (disc + knockout rings).
    const single = els.find((e) => e.id === "pip-0")!;
    expect(single.pass).toBe("foilGold");
    expect(single.fillRule).toBe("evenodd");
    expect((single.paths[0]!.match(/Z/g) ?? []).length).toBeGreaterThan(1);
    expect(single.paths[0]!.length).toBeGreaterThan(400);
    // Multi: solid disc on foil + glyph on engrave.
    const multi = layoutLidArt(defaults, enabled({ passMode: "multi" }), { font });
    const disc = multi.find((e) => e.id === "pip-0")!;
    const glyph = multi.find((e) => e.id === "pip-0-glyph")!;
    expect(disc.pass).toBe("foilGold");
    expect(disc.paths[0]).toContain("A"); // plain ellipse disc
    expect(glyph.pass).toBe("engrave");
    expect(glyph.paths[0]!.length).toBeGreaterThan(200);
    // Single mode emits NO engrave elements at all.
    expect(els.every((e) => e.pass !== "engrave")).toBe(true);
  });

  test("a missing symbol path degrades that coin to a plain disc (data gap only)", () => {
    const els2 = layoutLidArt(defaults, enabled({ symbolPaths: { W: SYMBOLS.W! } }), { font });
    const withGlyph = els2.find((e) => e.id === "pip-0")!; // W
    const plain = els2.find((e) => e.id === "pip-1")!; // U — no path given
    expect((withGlyph.paths[0]!.match(/Z/g) ?? []).length).toBeGreaterThan(1);
    expect((plain.paths[0]!.match(/Z/g) ?? []).length).toBe(1);
  });
});

describe("name auto-sizing", () => {
  test("a long single-word name shrinks to fit the width; no epithet appears", () => {
    const els = layoutLidArt(defaults, enabled({ name: "Supercalifragilisticexpialidocious" }), {
      font,
    });
    expect(els.find((e) => e.id === "epithet")).toBeUndefined();
    const name = els.find((e) => e.id === "name")!;
    const vz = visibleZone(defaults);
    expect(name.bbox.x1 - name.bbox.x0).toBeLessThanOrEqual(vz.x1 - vz.x0);
    expect(name.bbox.y1 - name.bbox.y0).toBeLessThan(5); // width-fit shrank it well below target
  });

  test("no font -> glyphs omitted but rules remain", () => {
    const els = layoutLidArt(defaults, enabled(), {});
    expect(els.find((e) => e.id === "name")).toBeUndefined();
    expect(els.find((e) => e.id === "name-rules")).toBeTruthy();
  });
});

describe("degradation", () => {
  test("coins shrink under space pressure before the orbit drops", () => {
    const sizeAt = (cardCount: number): number | null => {
      const els = layoutLidArt(mk({ cardCount }), enabled(), { font });
      const pip = els.find((e) => e.id === "pip-0");
      return pip ? pip.bbox.x1 - pip.bbox.x0 : null;
    };
    const at120 = sizeAt(120);
    expect(at120).not.toBeNull();
    expect(at120!).toBeLessThanOrEqual(pipBaseD(4));
    // A shorter box still ships all four coins, smaller — shrink before drop.
    let shrunk = false;
    for (let cards = 115; cards >= 80; cards -= 5) {
      const s = sizeAt(cards);
      if (s != null && s < at120! - 0.25) {
        shrunk = true;
        break;
      }
    }
    expect(shrunk).toBe(true);
  });

  test("order: orbit drops, then epithet, then primary shrinks, then crown", () => {
    const seq = [140, 120, 100, 90, 80, 65, 50, 40, 32, 26, 22, 18].map((cardCount) => {
      const els = layoutLidArt(mk({ cardCount }), enabled(), { font });
      const ids = els.map((e) => e.id);
      const name = els.find((e) => e.id === "name");
      return {
        pips: ids.some((i) => i.startsWith("pip-")),
        epithet: ids.includes("epithet"),
        name: name != null,
        crown: ids.includes("crown"),
      };
    });
    for (const s of seq) {
      if (s.pips) expect(s.epithet).toBe(true); // the orbit never outlives the epithet
      if (s.epithet) expect(s.name).toBe(true);
    }
    expect(seq.some((s) => s.pips)).toBe(true); // full composition happens
    expect(seq.some((s) => !s.pips && s.epithet)).toBe(true); // orbit dropped first
    expect(seq.some((s) => !s.epithet && s.name)).toBe(true); // then the epithet
  });

  test("uniformPips pins every identity count to the 5-colour coin size", () => {
    const p = mk({ lidPull: 0 }); // the roomy straight-row layout (no pull hole)
    for (const pips of [["W"], ["W", "U", "B", "R", "G"]]) {
      const els = layoutLidArt(p, enabled({ pips, uniformPips: true }), { font });
      const pip = els.find((e) => e.id === "pip-0")!;
      expect(pip.bbox.x1 - pip.bbox.x0).toBeCloseTo(PIP_UNIFORM_D, 6);
    }
    // Contrast: adaptive sizing gives a lone mono coin the big diameter.
    const adaptive = layoutLidArt(p, enabled({ pips: ["W"] }), { font });
    const lone = adaptive.find((e) => e.id === "pip-0")!;
    expect(lone.bbox.x1 - lone.bbox.x0).toBeGreaterThan(PIP_UNIFORM_D + 2);
  });

  test("disabled -> no elements", () => {
    expect(layoutLidArt(defaults, { ...DEFAULT_LID_ART, enabled: false }, { font })).toEqual([]);
  });

  test("no pull hole -> coins fall back to a straight centred row instead of vanishing", () => {
    const p = mk({ lidPull: 0 });
    expect(pullHole(p)).toBeNull();
    const els = layoutLidArt(p, enabled(), { font });
    const pips = els.filter((e) => e.id.startsWith("pip-"));
    expect(pips.length).toBe(4);
    const centers = pips.map((e) => ({
      x: (e.bbox.x0 + e.bbox.x1) / 2,
      y: (e.bbox.y0 + e.bbox.y1) / 2,
      d: e.bbox.x1 - e.bbox.x0,
    }));
    // One row: same y, evenly spaced left to right, centred on the lid.
    for (const c of centers) expect(c.y).toBeCloseTo(centers[0]!.y, 6);
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i]!.x).toBeGreaterThan(centers[i - 1]!.x + centers[i]!.d - 1e-6);
    }
    const vz = visibleZone(p);
    expect((centers[0]!.x + centers[3]!.x) / 2).toBeCloseTo((vz.x0 + vz.x1) / 2, 6);
    for (const el of pips) expect(inside(el.bbox, vz)).toBe(true);
    // Vertically centred between the name block and the content bottom (only the content pad 1
    // below vz.y0 — the lid frame replaces the pinstripe border, so there is no border inset),
    // not hugging the bottom.
    const rules = els.find((e) => e.id === "name-rules")!;
    const contentBottom = vz.y0 + 1;
    const gapAbove = rules.bbox.y0 - (centers[0]!.y + centers[0]!.d / 2);
    const gapBelow = centers[0]!.y - centers[0]!.d / 2 - contentBottom;
    expect(gapAbove).toBeCloseTo(gapBelow, 6);
    expect(gapBelow).toBeGreaterThan(0.5);
  });

  test("tiny lids keep every survivor inside the zone and off the hole", () => {
    for (const cardCount of [40, 25, 15]) {
      const p = mk({ cardCount, cardWidth: 63.5, cardHeight: 88.9, cardThickness: 0.305 });
      const els = layoutLidArt(p, enabled(), { font });
      const vz = visibleZone(p);
      const hole = pullHole(p);
      for (const el of els) {
        if (zoneConfined(el.id)) expect(inside(el.bbox, vz), el.id).toBe(true);
        if (hole && !ENCIRCLES_HOLE.has(el.id)) {
          expect(bboxToPoint(el.bbox, hole.cx, hole.cy)).toBeGreaterThanOrEqual(
            hole.r + HOLE_CLEAR - 1e-6,
          );
        }
      }
    }
  });
});

describe("sanitizeLidArt", () => {
  test("an old blob with retired raster keys loads cleanly (keys silently dropped)", () => {
    const old = {
      enabled: true,
      name: "Atraxa, Praetors' Voice",
      pips: ["W", "U", "B", "G"],
      passMode: "multi",
      artBand: true,
      artDataUrl: "data:image/png;base64,AAAA",
      artSrcUrl: "https://example.com/art.jpg",
      layout: "fullBleed",
      halftone: "lines",
    };
    const clean = sanitizeLidArt(old);
    expect(clean).toEqual({
      enabled: true,
      name: "Atraxa, Praetors' Voice",
      pips: ["W", "U", "B", "G"],
      symbolPaths: {},
      passMode: "multi",
      uniformPips: false,
    });
    expect(Object.keys(clean).sort()).toEqual([
      "enabled",
      "name",
      "passMode",
      "pips",
      "symbolPaths",
      "uniformPips",
    ]);
  });

  test("non-object root -> defaults; junk values rejected field-by-field", () => {
    expect(sanitizeLidArt(null)).toEqual(DEFAULT_LID_ART);
    expect(sanitizeLidArt("nope")).toEqual(DEFAULT_LID_ART);
    const clean = sanitizeLidArt({
      enabled: "yes", // wrong type -> default
      name: 42, // wrong type -> default
      pips: ["W", "X", 5, "G"], // pinned to the symbol alphabet
      symbolPaths: { W: "M0 0L1 0L1 1Z", X: "M0 0", U: 42 },
      passMode: "sideways",
    });
    expect(clean.enabled).toBe(false);
    expect(clean.name).toBe("");
    expect(clean.pips).toEqual(["W", "G"]);
    expect(clean.symbolPaths).toEqual({ W: "M0 0L1 0L1 1Z" });
    expect(clean.passMode).toBe("single");
  });

  test("pips are sorted into canonical WUBRG order", () => {
    expect(sortPips(["G", "U", "R", "W", "B"])).toEqual(["W", "U", "B", "R", "G"]);
    expect(sortPips(["C"])).toEqual(["C"]);
    // sanitize applies the same ordering to persisted blobs (Scryfall order isn't guaranteed).
    const clean = sanitizeLidArt({ ...DEFAULT_LID_ART, pips: ["G", "B", "U", "W"] });
    expect(clean.pips).toEqual(["W", "U", "B", "G"]);
  });
});

describe("visible zone", () => {
  test("with the lid frame on (default) it is the frame's window, inset past the corner cusps", () => {
    const vz = visibleZone(defaults);
    const cap = capSpec(defaults)!;
    const d = dims(defaults);
    const xoff = (d.lidW - cap.w) / 2;
    // Inset ≥ cusp/√2 on every side: the zone's rect corners clear the cusps' quarter discs.
    const m = Math.min(vz.x0 - (xoff + cap.window.x0), vz.y0 - cap.window.y0);
    expect(m).toBeGreaterThanOrEqual(cap.cusp * Math.SQRT1_2 - 1e-9);
    expect(vz.x1 - vz.x0).toBeLessThan(cap.window.x1 - cap.window.x0);
    expect((vz.x0 + vz.x1) / 2).toBeCloseTo(d.lidW / 2, 6); // centred on the lid
  });

  test("with the frame off it is the lid face minus the hidden groove depth on each x side", () => {
    const p = mk({ capRail: 0 });
    const vz = visibleZone(p);
    expect(vz.x1 - vz.x0).toBeCloseTo(dims(p).innerW, 6); // 68.5 at Commander defaults
    expect(vz.y1).toBeLessThan(dims(p).lidL); // a foil margin off the front/back cut edges
  });
});
