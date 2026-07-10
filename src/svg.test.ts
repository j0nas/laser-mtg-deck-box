// Layout + SVG tests: every panel cut exactly once, parts never overlap or crowd the sheet edge,
// oversize detection, and the SVG's coordinate mapping (y-flip into SVG's y-down space).

import { describe, expect, test } from "vite-plus/test";
import { panels } from "./panels.ts";
import { defaults, type Params } from "./params.ts";
import { filenameStem, layout, sheetSvg, totalPanelArea } from "./svg.ts";

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

describe("readout helpers", () => {
  test("total panel area is plausible: more than the outer faces' halves, less than their sum", () => {
    // Loose physical bounds: each of the 10 blanks minus joinery must land between 50% and 100%
    // of the summed blank envelopes.
    const blanks = panels(defaults).reduce((s, p) => s + p.size[0] * p.size[1], 0);
    const area = totalPanelArea(defaults);
    expect(area).toBeGreaterThan(blanks * 0.5);
    expect(area).toBeLessThan(blanks);
  });

  test("filename stem carries the two params that matter at the laser", () => {
    expect(filenameStem(defaults)).toBe("laser-deck-box-100-cards-3.2mm");
  });
});
