// Sheet layout + SVG export, on parametric-kit/laser: the lid is pinned to the first sheet's
// bottom-left corner (it carries the foil marque — a user can pre-foil that known spot of the raw
// sheet, patch size in the readout), everything else shelf-packs tallest first. This file owns
// what stays app-specific: the marque overlay layers, the filename stem and the readout totals.

import {
  fmtMm as fmt,
  type Layout,
  layoutSheets,
  panelArea,
  type Sheet,
  sheetSvg as cutSvg,
} from "parametric-kit/laser";
import type { LidArtElement, LidArtPass, PassMode } from "./lidart.ts";
import { panels } from "./panels.ts";
import type { Params } from "./params.ts";

export type { Layout, Placement, Sheet } from "parametric-kit/laser";

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

export function layout(p: Params): Layout {
  return layoutSheets(
    panels(p),
    { sheetW: p.sheetW, sheetH: p.sheetH, gap: p.partGap },
    { pin: "lid" },
  );
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

// A full sheet as a standalone SVG. When the lid marque is enabled, its filled engrave/foil
// regions are laid over the lid panel, before the cut paths.
export function sheetSvg(sheet: Sheet, p: Params, art?: LidArtSheet): string {
  let prelude = "";
  if (art && art.elements.length > 0) {
    const lid = sheet.placements.find((pl) => pl.panel.id === "lid");
    if (lid) prelude = lidArtSvg(art.elements, art.mode, lid.x, lid.y, lid.panel.size[1]);
  }
  return cutSvg(sheet, p, prelude ? { prelude } : {});
}

// Filename stem shared by the downloads and the readout, e.g. "laser-deck-box-100-cards-3.2mm".
export function filenameStem(p: Params): string {
  return `laser-deck-box-${p.cardCount}-cards-${fmt(p.thickness)}mm`;
}

// Total panel area (mm²) — drives the weight estimate in the readout.
export function totalPanelArea(p: Params): number {
  return panels(p).reduce((sum, panel) => sum + panelArea(panel), 0);
}

// Sanity data for the readout: does the tallest/widest part even fit the configured sheet?
export function sheetFits(p: Params): boolean {
  return layout(p).oversize.length === 0;
}
