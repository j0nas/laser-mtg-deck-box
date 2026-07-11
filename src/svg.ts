// Sheet layout + SVG export: packs the panel outlines onto laser sheets (lid pinned to the first
// sheet's bottom-left corner, everything else shelf-packed tallest first) and renders each sheet as
// a real-units SVG of hairline cut paths. Pure string/number code — the download itself goes
// through parametric-kit/export in main.ts.

import type { LidArtElement, LidArtPass, PassMode } from "./lidart.ts";
import { type Panel, panels, type Pt } from "./panels.ts";
import type { Params } from "./params.ts";

// The lid marque to overlay on the lid panel, if enabled. Passed through from main.ts.
export type LidArtSheet = { elements: LidArtElement[]; mode: PassMode };

// LightBurn-style layer colours. Cut stays red (#ff0000). In "single" mode every marque element
// lands on ONE foil layer (blue) — the physical foil colour is chosen at the machine, so the file is
// identical whichever foil the user lays down. In "multi" mode the semantic passes split out:
// dark engrave (black) and gold foil (blue).
export function layerColor(pass: LidArtPass, mode: PassMode): string {
  if (mode === "single") return "#0000ff";
  return pass === "engrave" ? "#000000" : "#0000ff";
}

export type Placement = { panel: Panel; x: number; y: number };
export type Sheet = { placements: Placement[] };
export type Layout = {
  sheets: Sheet[];
  oversize: string[]; // panel ids that cannot fit the sheet at all (readout warns, nothing is cut)
};

// Sheet layout. The LID is pinned to the first sheet's bottom-left corner — it carries the foil
// marque, so it must land at a KNOWN spot: partGap in from both edges, whatever the other params
// do. A user can pre-foil that corner of the raw sheet (patch size in the readout) instead of
// measuring where the lid happened to fall. Everything else shelf-packs tallest-first into
// left-to-right rows; a row that reaches down into the reserved lid corner starts to its right.
// partGap separates parts from each other AND from the sheet edges. Bottom-left (not top-left)
// because the packer puts its tallest rows at the top: the reserved corner then coexists with the
// naturally short last row instead of displacing a tall first row.
export function layout(p: Params): Layout {
  const gap = p.partGap;
  const usableW = p.sheetW - 2 * gap;
  const usableH = p.sheetH - 2 * gap;
  const all = panels(p);
  const lid = all.find((pl) => pl.id === "lid");
  const sorted = all
    .filter((pl) => pl !== lid)
    .sort((a, b) => b.size[1] - a.size[1] || b.size[0] - a.size[0] || a.id.localeCompare(b.id));

  const sheets: Sheet[] = [];
  const oversize: string[] = [];
  let sheet: Sheet = { placements: [] };
  let x = gap;
  let y = gap;
  let rowH = 0;

  // The reserved corner: the lid plus a gap-wide moat on its open (right and top) sides.
  let corner: { right: number; top: number } | null = null;
  if (lid) {
    const [w, h] = lid.size;
    if (w > usableW || h > usableH) {
      oversize.push(lid.id);
    } else {
      sheet.placements.push({ panel: lid, x: gap, y: p.sheetH - gap - h });
      corner = { right: gap + w + gap, top: p.sheetH - gap - h - gap };
    }
  }

  const openSheet = () => {
    if (sheet.placements.length > 0) sheets.push(sheet);
    sheet = { placements: [] };
    x = gap;
    y = gap;
    rowH = 0;
    corner = null; // only the first sheet hosts the lid
  };

  for (const panel of sorted) {
    const [w, h] = panel.size;
    if (w > usableW || h > usableH) {
      oversize.push(panel.id);
      continue;
    }
    for (;;) {
      if (y + h > gap + usableH + 1e-9) {
        openSheet();
        continue;
      }
      // Slide right past the reserved corner when this part would reach down into it.
      const px = corner && x < corner.right && y + h > corner.top + 1e-9 ? corner.right : x;
      if (px + w > gap + usableW + 1e-9) {
        if (x === gap && rowH === 0) {
          // A fresh row and still no room: the corner blocks this whole band, and every row
          // below reaches even deeper into it — only a new sheet can help.
          openSheet();
        } else {
          x = gap;
          y += rowH + gap;
          rowH = 0;
        }
        continue;
      }
      sheet.placements.push({ panel, x: px, y });
      x = px + w + gap;
      rowH = Math.max(rowH, h);
      break;
    }
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

// The lid marque as SVG, placed on the lid panel at (px, py). Filled foil/engrave regions render
// BEFORE the cut so a laser processes engrave/foil first and the cut releases the lid last. The lid
// is engraved on its as-cut top face, which is the assembled box's visible top face (the lid's place
// rotation is identity), so no mirroring is applied — the art reads correctly with the drawn face up.
// All elements share the panel's y-flip via one group transform.
function lidArtSvg(
  els: LidArtElement[],
  mode: PassMode,
  px: number,
  py: number,
  lidL: number,
): string {
  const vectors: string[] = [];
  for (const el of els) {
    if (el.paths.length === 0) continue;
    const color = layerColor(el.pass, mode);
    vectors.push(
      `    <path id="marque-${el.id}" d="${el.paths.join("")}" fill="${color}" fill-rule="${el.fillRule}"/>`,
    );
  }
  if (vectors.length === 0) return "";
  return `  <g transform="translate(${fmt(px)} ${fmt(py + lidL)}) scale(1 -1)">\n${vectors.join("\n")}\n  </g>`;
}

// A full sheet as a standalone SVG in real millimetre units: hairline red cut strokes, one path per
// panel (outline + interior holes as subpaths), ids preserved for laser software that shows them.
// When the lid marque is enabled, its filled engrave/foil regions are laid over the lid panel.
export function sheetSvg(sheet: Sheet, p: Params, art?: LidArtSheet): string {
  const paths = sheet.placements
    .map(({ panel, x, y }) => {
      const h = panel.size[1];
      const d = [subpath(panel.outline, x, y, h), ...panel.holes.map((ho) => subpath(ho, x, y, h))];
      return `  <path id="${panel.id}" d="${d.join(" ")}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`;
    })
    .join("\n");

  let artBody = "";
  if (art && art.elements.length > 0) {
    const lid = sheet.placements.find((pl) => pl.panel.id === "lid");
    if (lid) artBody = lidArtSvg(art.elements, art.mode, lid.x, lid.y, lid.panel.size[1]);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(p.sheetW)}mm" height="${fmt(p.sheetH)}mm" viewBox="0 0 ${fmt(p.sheetW)} ${fmt(p.sheetH)}">`,
    ...(artBody ? [artBody] : []),
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
