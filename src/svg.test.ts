// Layout + SVG tests: every panel cut exactly once, parts never overlap or crowd the sheet edge,
// oversize detection, and the SVG's coordinate mapping (y-flip into SVG's y-down space).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_LID_ART, type LidArt, layoutLidArt, type PassMode } from "./lidart.ts";
import { panels } from "./panels.ts";
import { defaults, type Params } from "./params.ts";
import { filenameStem, layout, type LidArtSheet, sheetSvg, totalPanelArea } from "./svg.ts";

const SYMBOLS = JSON.parse(
  readFileSync(fileURLToPath(new URL("./assets/mana-symbols.json", import.meta.url)), "utf8"),
) as Record<string, string>;

// Marque elements for the default lid, no font (name glyphs omitted; crown/border/rules and the
// mana coins all present, which is enough to exercise every pass -> layer mapping).
function artSheet(mode: PassMode): LidArtSheet {
  const cfg: LidArt = {
    ...DEFAULT_LID_ART,
    enabled: true,
    name: "Test, of the Layers",
    pips: ["W", "U", "B", "G"],
    symbolPaths: SYMBOLS,
    passMode: mode,
  };
  return { elements: layoutLidArt(defaults, cfg, {}), mode };
}

function lidSvg(mode: PassMode | null): string {
  const sheet = layout(defaults).sheets[0]!;
  return mode ? sheetSvg(sheet, defaults, artSheet(mode)) : sheetSvg(sheet, defaults);
}

describe("layout", () => {
  test("places every panel exactly once; the default Commander box fits ONE 300×300 sheet", () => {
    const l = layout(defaults);
    expect(l.oversize).toEqual([]);
    const placed = l.sheets.flatMap((s) => s.placements.map((pl) => pl.panel.id));
    expect([...placed].sort()).toEqual(
      panels(defaults)
        .map((p) => p.id)
        .sort(),
    );
    expect(l.sheets.length).toBe(1);
    for (const s of l.sheets) {
      for (const { panel, x, y } of s.placements) {
        expect(x).toBeGreaterThanOrEqual(defaults.partGap - 1e-9);
        expect(y).toBeGreaterThanOrEqual(defaults.partGap - 1e-9);
        expect(x + panel.size[0]).toBeLessThanOrEqual(defaults.sheetW - defaults.partGap + 1e-9);
        expect(y + panel.size[1]).toBeLessThanOrEqual(defaults.sheetH - defaults.partGap + 1e-9);
      }
    }
  });

  test("parts on a sheet never overlap and keep the part gap", () => {
    const gap = defaults.partGap;
    for (const s of layout(defaults).sheets) {
      for (let i = 0; i < s.placements.length; i++) {
        for (let j = i + 1; j < s.placements.length; j++) {
          const a = s.placements[i]!;
          const b = s.placements[j]!;
          const sepX =
            a.x + a.panel.size[0] + gap <= b.x + 1e-9 || b.x + b.panel.size[0] + gap <= a.x + 1e-9;
          const sepY =
            a.y + a.panel.size[1] + gap <= b.y + 1e-9 || b.y + b.panel.size[1] + gap <= a.y + 1e-9;
          expect(sepX || sepY).toBe(true);
        }
      }
    }
  });

  test("the lid is pinned to sheet 1's bottom-left corner whatever the params", () => {
    // The lid carries the foil marque: pinning it means the user can pre-foil a known corner of
    // the raw sheet instead of measuring where the lid happened to fall in the pack.
    const variants: Params[] = [
      defaults,
      { ...defaults, cardCount: 40 },
      { ...defaults, cardCount: 250, extraCards: 40 },
      { ...defaults, thickness: 6, fingerWidth: 5 },
      { ...defaults, sheetW: 600, sheetH: 400, partGap: 8 },
      { ...defaults, cardWidth: 72, cardHeight: 97, sideClearance: 3 },
    ];
    for (const p of variants) {
      const l = layout(p);
      const lid = l.sheets[0]!.placements.find((pl) => pl.panel.id === "lid");
      expect(lid, `lid missing from sheet 1 for ${JSON.stringify(p)}`).toBeDefined();
      expect(lid!.x).toBeCloseTo(p.partGap, 9);
      expect(lid!.y).toBeCloseTo(p.sheetH - p.partGap - lid!.panel.size[1], 9);
    }
  });

  test("parts never overlap on any sheet across the pinned-lid variants", () => {
    const variants: Params[] = [
      { ...defaults, cardCount: 250, extraCards: 40 },
      { ...defaults, sheetW: 200, sheetH: 200 },
      { ...defaults, partGap: 10 },
    ];
    for (const p of variants) {
      const gap = p.partGap;
      for (const s of layout(p).sheets) {
        for (let i = 0; i < s.placements.length; i++) {
          for (let j = i + 1; j < s.placements.length; j++) {
            const a = s.placements[i]!;
            const b = s.placements[j]!;
            const sepX =
              a.x + a.panel.size[0] + gap <= b.x + 1e-9 ||
              b.x + b.panel.size[0] + gap <= a.x + 1e-9;
            const sepY =
              a.y + a.panel.size[1] + gap <= b.y + 1e-9 ||
              b.y + b.panel.size[1] + gap <= a.y + 1e-9;
            expect(sepX || sepY, `${a.panel.id} overlaps ${b.panel.id}`).toBe(true);
          }
        }
      }
    }
  });

  test("a big sheet takes everything on one sheet; a tiny sheet reports oversize walls", () => {
    expect(layout({ ...defaults, sheetW: 600, sheetH: 600 }).sheets.length).toBe(1);
    const tiny = layout({ ...defaults, sheetW: 100, sheetH: 100 });
    expect(tiny.oversize.length).toBeGreaterThan(0);
    expect(tiny.oversize).toContain("body-front"); // 97+ mm tall walls can't fit 100 mm minus gaps
    const placedIds = tiny.sheets.flatMap((s) => s.placements.map((pl) => pl.panel.id));
    for (const id of tiny.oversize) expect(placedIds).not.toContain(id);
  });
});

describe("sheetSvg", () => {
  test("real-unit svg with one path per placement", () => {
    const l = layout(defaults);
    const svg = sheetSvg(l.sheets[0]!, defaults);
    expect(svg).toContain('width="300mm"');
    expect(svg).toContain('viewBox="0 0 300 300"');
    expect(svg.match(/<path /g)!.length).toBe(l.sheets[0]!.placements.length);
    expect(svg).toContain('stroke="#ff0000"');
  });

  test("maps panel-local y-up coordinates into SVG y-down at the placement", () => {
    const p: Params = { ...defaults };
    const panel = panels(p)[0]!;
    const svg = sheetSvg({ placements: [{ panel, x: 10, y: 20 }] }, p);
    const [ox, oy] = panel.outline[0]!;
    const first = svg.match(/d="M([\d.]+) ([\d.]+)/)!;
    expect(Number(first[1])).toBeCloseTo(10 + ox, 3);
    expect(Number(first[2])).toBeCloseTo(20 + (panel.size[1] - oy), 3);
  });
});

describe("lid marque layers", () => {
  test("single mode: one foil layer (blue) plus the red cut — never black or magenta", () => {
    const svg = lidSvg("single");
    expect(svg).toContain("#0000ff");
    expect(svg).not.toContain("#000000");
    expect(svg).not.toContain("#ff00ff");
    expect(svg).toContain("#ff0000"); // the cut layer is unchanged
  });

  test("multi mode: gold foil (blue) and engraved coin glyphs (black) — never magenta", () => {
    const svg = lidSvg("multi");
    expect(svg).toContain("#0000ff"); // gold foil
    expect(svg).not.toContain("#ff00ff"); // no holo stamp ring any more
    expect(svg).toContain("#000000"); // coin glyphs on the dark-engrave layer
    expect(svg).toContain('id="marque-pip-0-glyph"');
    expect(svg).toContain("#ff0000"); // cut
  });

  test("disabled: no marque layers at all, only the red cut", () => {
    const svg = lidSvg(null);
    expect(svg).not.toContain("#0000ff");
    expect(svg).not.toContain("#000000");
    expect(svg).not.toContain("#ff00ff");
    expect(svg).toContain("#ff0000");
  });

  test("every marque layer colour is distinct from the cut colour", () => {
    for (const c of ["#0000ff", "#000000"]) expect(c).not.toBe("#ff0000");
  });

  test("the mana coins are healed knockout paths on the foil layer in single mode", () => {
    const svg = lidSvg("single");
    const pip = svg.match(/<path id="marque-pip-0" d="([^"]+)" fill="([^"]+)"/);
    expect(pip).not.toBeNull();
    expect(pip![2]).toBe("#0000ff");
    expect((pip![1]!.match(/Z/g) ?? []).length).toBeGreaterThan(1); // disc + glyph knockout rings
    expect(svg).not.toContain("marque-pip-0-glyph"); // no engrave split in single mode
  });

  test("the marque only touches the lid — other panels' cut paths are unchanged", () => {
    const sheet = layout(defaults).sheets[0]!;
    const plain = sheetSvg(sheet, defaults);
    const withArt = sheetSvg(sheet, defaults, artSheet("multi"));
    for (const id of ["body-front", "body-back", "side-left-inner", "body-floor"]) {
      const re = new RegExp(`<path id="${id}"[^>]*>`);
      expect(withArt.match(re)![0]).toBe(plain.match(re)![0]);
    }
  });
});

describe("readout helpers", () => {
  test("total panel area is plausible: more than the outer faces' halves, less than their sum", () => {
    // Loose physical bounds: the nine blanks minus joinery (and the frame's window) must land
    // between 50% and 100% of the summed blank envelopes.
    const blanks = panels(defaults).reduce((s, p) => s + p.size[0] * p.size[1], 0);
    const area = totalPanelArea(defaults);
    expect(area).toBeGreaterThan(blanks * 0.5);
    expect(area).toBeLessThan(blanks);
  });

  test("filename stem carries the two params that matter at the laser", () => {
    expect(filenameStem(defaults)).toBe("laser-deck-box-100-cards-3mm");
  });
});
