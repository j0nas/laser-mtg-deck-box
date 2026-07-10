// Sheet layout + SVG export: packs the ten panel outlines onto laser sheets (shelf packing, tallest
// first) and renders each sheet as a real-units SVG of hairline cut paths. Pure string/number code —
// the download itself goes through parametric-kit/export in main.ts.

import { type Panel, panels, type Pt } from "./panels.ts";
import { dims, type Params } from "./params.ts";

export type Placement = { panel: Panel; x: number; y: number };
export type Sheet = { placements: Placement[] };
export type Layout = {
  sheets: Sheet[];
  oversize: string[]; // panel ids that cannot fit the sheet at all (readout warns, nothing is cut)
};

// Shelf packing: sort tallest-first, fill left-to-right rows, open a new row (then a new sheet)
// when a panel doesn't fit. partGap separates parts from each other AND from the sheet edges.
export function layout(p: Params): Layout {
  const gap = p.partGap;
  const usableW = p.sheetW - 2 * gap;
  const usableH = p.sheetH - 2 * gap;
  const sorted = [...panels(p)].sort(
    (a, b) => b.size[1] - a.size[1] || b.size[0] - a.size[0] || a.id.localeCompare(b.id),
  );

  const sheets: Sheet[] = [];
  const oversize: string[] = [];
  let sheet: Sheet = { placements: [] };
  let x = gap;
  let y = gap;
  let rowH = 0;

  const openSheet = () => {
    if (sheet.placements.length > 0) sheets.push(sheet);
    sheet = { placements: [] };
    x = gap;
    y = gap;
    rowH = 0;
  };

  for (const panel of sorted) {
    const [w, h] = panel.size;
    if (w > usableW || h > usableH) {
      oversize.push(panel.id);
      continue;
    }
    if (x + w > gap + usableW + 1e-9) {
      // next row
      x = gap;
      y += rowH + gap;
      rowH = 0;
    }
    if (y + h > gap + usableH + 1e-9) openSheet();
    sheet.placements.push({ panel, x, y });
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  if (sheet.placements.length > 0) sheets.push(sheet);
  return { sheets, oversize };
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

// One closed subpath. Panel outlines are y-up; SVG is y-down, so flip within the panel's own height.
function subpath(pts: Pt[], ox: number, oy: number, panelH: number): string {
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fmt(ox + x)} ${fmt(oy + panelH - y)}`);
  return `${d.join("")}Z`;
}

// A full sheet as a standalone SVG in real millimetre units: hairline red cut strokes, one path per
// panel (outline + interior holes as subpaths), ids preserved for laser software that shows them.
export function sheetSvg(sheet: Sheet, p: Params): string {
  const paths = sheet.placements
    .map(({ panel, x, y }) => {
      const h = panel.size[1];
      const d = [subpath(panel.outline, x, y, h), ...panel.holes.map((ho) => subpath(ho, x, y, h))];
      return `  <path id="${panel.id}" d="${d.join(" ")}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`;
    })
    .join("\n");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(p.sheetW)}mm" height="${fmt(p.sheetH)}mm" viewBox="0 0 ${fmt(p.sheetW)} ${fmt(p.sheetH)}">`,
    paths,
    `</svg>`,
    ``,
  ].join("\n");
}

// Filename stem shared by the downloads and the readout, e.g. "laser-deck-box-100-cards-3.2mm".
export function filenameStem(p: Params): string {
  return `laser-deck-box-${p.cardCount}-cards-${fmt(p.thickness)}mm`;
}

// Total panel area (mm²) via the shoelace formula — drives the weight estimate in the readout.
export function totalPanelArea(p: Params): number {
  let area = 0;
  for (const panel of panels(p)) {
    let a = 0;
    for (let i = 0; i < panel.outline.length; i++) {
      const [x1, y1] = panel.outline[i]!;
      const [x2, y2] = panel.outline[(i + 1) % panel.outline.length]!;
      a += x1 * y2 - x2 * y1;
    }
    area += Math.abs(a) / 2;
    for (const hole of panel.holes) {
      let ha = 0;
      for (let i = 0; i < hole.length; i++) {
        const [x1, y1] = hole[i]!;
        const [x2, y2] = hole[(i + 1) % hole.length]!;
        ha += x1 * y2 - x2 * y1;
      }
      area -= Math.abs(ha) / 2;
    }
  }
  return area;
}

// Sanity data for the readout: does the tallest/widest part even fit the configured sheet?
export function sheetFits(p: Params): boolean {
  return layout(p).oversize.length === 0;
}

export function assembledSummary(p: Params): { w: number; d: number; h: number } {
  const dm = dims(p);
  return { w: dm.capOuterW, d: dm.capOuterD, h: dm.assembledH };
}
