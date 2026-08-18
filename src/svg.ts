// Sheet layout + SVG export, on parametric-kit/laser: the MARQUE PANEL — the lid, or the lid
// frame when its face is solid — is pinned to the first sheet's bottom-left corner (it carries
// the foil marque — a user can pre-foil that known spot of the raw sheet, patch size in the
// readout), everything else shelf-packs tallest first. This file owns what stays app-specific:
// the marque/wall-art overlay layers, the filename stem and the readout totals.

import {
  fmtMm as fmt,
  type Layout,
  layoutSheets,
  panelArea,
  type Sheet,
  sheetSvg as cutSvg,
} from "parametric-kit/laser";
import { type LidArtElement, type LidArtPass, marquePanel } from "./lidart.ts";
import { panels } from "./panels.ts";
import type { Params } from "./params.ts";
import type { WallArt } from "./sideart.ts";

export type { Layout, Placement, Sheet } from "parametric-kit/laser";

// The art overlays for a sheet, passed through from main.ts: the marque's element list (local to
// marquePanel(p) — sheetSvg routes it there) plus the decorated walls'. Each lands on its own
// panel's placement; panels absent from a sheet are simply skipped, so multi-sheet layouts get
// each overlay exactly once, wherever its panel fell.
export type SheetArt = {
  marque?: LidArtElement[] | undefined;
  walls?: WallArt[] | undefined;
};

// LightBurn-style layer colours. Cut stays red (#ff0000) — including the pierced finish's marque
// cutouts, which are real through-cuts and ride the same layer as the panel outlines (LightBurn
// cuts inner shapes before the releasing perimeter by default). Foil rides blue (#0000ff) — in
// the foil finish's "single" mode every marque element is tagged foilGold, so the whole marque
// lands on that one layer and the physical foil colour stays a choice at the machine. Everything
// engraved (multi-mode coin glyphs, the non-foil marques' char, all wall art) rides black
// (#000000).
export function layerColor(pass: LidArtPass): string {
  if (pass === "cut") return "#ff0000";
  return pass === "engrave" ? "#000000" : "#0000ff";
}

export function layout(p: Params): Layout {
  return layoutSheets(
    panels(p),
    { sheetW: p.sheetW, sheetH: p.sheetH, gap: p.partGap },
    { pin: marquePanel(p) },
  );
}

// One panel's art as SVG, placed at (px, py). Filled engrave/foil regions render BEFORE the cut so
// a laser processes engrave/foil first and the cut releases the part last (the pierced marque's
// red cut fills join the cut layer itself — see layerColor). Every decorated panel is engraved on
// its as-cut top face — the marque panel's visible top, the walls' outward faces (panels.ts
// mirrors the left outer layer to make that hold) — so no mirroring is applied here: the art reads
// correctly with the drawn face up. All elements share the panel's y-flip via one group transform.
function panelArtSvg(
  els: LidArtElement[],
  idPrefix: string,
  px: number,
  py: number,
  panelH: number,
): string {
  const vectors: string[] = [];
  for (const el of els) {
    if (el.paths.length === 0) continue;
    const color = layerColor(el.pass);
    vectors.push(
      `    <path id="${idPrefix}-${el.id}" d="${el.paths.join("")}" fill="${color}" fill-rule="${el.fillRule}"/>`,
    );
  }
  if (vectors.length === 0) return "";
  return `  <g transform="translate(${fmt(px)} ${fmt(py + panelH)}) scale(1 -1)">\n${vectors.join("\n")}\n  </g>`;
}

// A full sheet as a standalone SVG. Art overlays are laid over their panels' placements, before
// the cut paths. The marque keeps its historic "marque" id prefix wherever it lands (lid, or the
// solid-faced frame — marquePanel routes it); wall overlays are prefixed by their panel id.
export function sheetSvg(sheet: Sheet, p: Params, art?: SheetArt): string {
  const groups: string[] = [];
  const overlays: { prefix: string; panelId: string; elements: LidArtElement[] }[] = [
    ...(art?.marque && art.marque.length > 0
      ? [{ prefix: "marque", panelId: marquePanel(p), elements: art.marque }]
      : []),
    ...(art?.walls ?? []).map((wa) => ({
      prefix: wa.panelId,
      panelId: wa.panelId,
      elements: wa.elements,
    })),
  ];
  for (const ov of overlays) {
    const pl = sheet.placements.find((q) => q.panel.id === ov.panelId);
    if (!pl) continue;
    const g = panelArtSvg(ov.elements, ov.prefix, pl.x, pl.y, pl.panel.size[1]);
    if (g) groups.push(g);
  }
  const prelude = groups.join("\n");
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
