// App entry: wires the kit's schema-driven panel, viewer and download helpers around this app's
// pure geometry (panels.ts) and sheet layout (svg.ts). The 3D preview and the exported SVGs are
// built from the same outlines.

import { downloadText } from "parametric-kit/export";
import { createStore, renderPanel } from "parametric-kit/params";
import { createViewer, installAppHook } from "parametric-kit/viewer";
import { Group, Matrix4, Mesh, MeshStandardMaterial, ExtrudeGeometry, Shape } from "three";
import { type Panel, panels, placeMatrix } from "./panels.ts";
import {
  capacity,
  DECK_PRESETS,
  dims,
  MATERIAL_PRESETS,
  materialFor,
  type Params,
  schema,
  SLEEVE_PRESETS,
} from "./params.ts";
import { filenameStem, layout, sheetSvg, totalPanelArea } from "./svg.ts";

const store = createStore(schema, { key: "laser-mtg-deck-box:params", version: 1 });
const params: Params = store.load();

const viewer = createViewer(document.getElementById("app")!);

type ViewMode = "assembled" | "open" | "flat";
const viewSelect = document.getElementById("viewMode") as HTMLSelectElement;
const viewMode = (): ViewMode => viewSelect.value as ViewMode;

// Preview tint per sheet material; the cap gets a slightly darker shade so the two parts read.
const TINTS: Record<string, number> = {
  "1/8″ basswood ply": 0xdcbd8e,
  "3mm MDF": 0xb59a7a,
  "1/8″ acrylic": 0xa9c8e0,
};

const modelGroup = new Group();
viewer.scene.add(modelGroup);

function panelMesh(panel: Panel, matrix: Matrix4, color: number): Mesh {
  const shape = new Shape();
  panel.outline.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth: params.thickness, bevelEnabled: false });
  const mesh = new Mesh(geo, new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 }));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrix);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function rebuild(): void {
  const old = modelGroup.children.slice();
  modelGroup.clear();
  for (const child of old) {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      (child.material as MeshStandardMaterial).dispose();
    }
  }

  const base = TINTS[materialFor(params.thickness).name] ?? TINTS["1/8″ basswood ply"]!;
  const capTint = base - 0x181818; // all tints keep every channel above 0x18, so this never wraps

  if (viewMode() === "flat") {
    const l = layout(params);
    let ox = 0;
    for (const sheet of l.sheets) {
      for (const { panel, x, y } of sheet.placements) {
        const m = new Matrix4().makeTranslation(ox + x, params.sheetH - y - panel.size[1], 0);
        modelGroup.add(panelMesh(panel, m, panel.id.startsWith("cap-") ? capTint : base));
      }
      ox += params.sheetW + 25;
    }
  } else {
    const lift = viewMode() === "open" ? dims(params).capH + 45 : 0;
    for (const panel of panels(params)) {
      const m = new Matrix4().fromArray(placeMatrix(panel.place));
      if (lift > 0 && panel.id.startsWith("cap-")) {
        m.premultiply(new Matrix4().makeTranslation(0, 0, lift));
      }
      modelGroup.add(panelMesh(panel, m, panel.id.startsWith("cap-") ? capTint : base));
    }
  }
  viewer.invalidate();
}

const dimsEl = document.getElementById("dims")!;
const warningsEl = document.getElementById("warnings")!;

function updateReadout(): void {
  const d = dims(params);
  const mat = materialFor(params.thickness);
  const grams = Math.round(((totalPanelArea(params) * params.thickness) / 1000) * mat.density);
  const l = layout(params);
  dimsEl.innerHTML = [
    `Closed box: <b>${d.capOuterW.toFixed(1)} × ${d.capOuterD.toFixed(1)} × ${d.assembledH.toFixed(1)} mm</b>`,
    `Fits <b>${capacity(params)}</b> cards (deck ${params.cardCount} + ${params.extraCards} spare)`,
    `${mat.name} · ~${grams} g · <b>${l.sheets.length}</b> sheet${l.sheets.length === 1 ? "" : "s"} of ${params.sheetW}×${params.sheetH}`,
  ].join("<br>");

  const warnings: string[] = [];
  if (l.oversize.length > 0) {
    warnings.push(
      `Too big for the sheet: ${l.oversize.join(", ")}. Grow the sheet or shrink the box.`,
    );
  }
  if (params.kerf === 0) {
    warnings.push("Kerf is 0 — joints will cut loose. Measure your laser's kerf (≈0.1–0.2 mm).");
  }
  warningsEl.style.display = warnings.length > 0 ? "" : "none";
  warningsEl.innerHTML = warnings.join("<br>");
}

const panel = renderPanel(document.getElementById("controls")!, schema, params, {
  groups: [
    { id: "cards", title: "Cards", presets: ["deck", "sleeve"] },
    {
      id: "material",
      title: "Material & joints",
      presets: ["material"],
      hint: (p) =>
        `Cut from ${materialFor(p.thickness).name}. Kerf grows every finger into a press-fit; ` +
        `fingers aim for ${p.fingerWidth} mm.`,
    },
    { id: "fit", title: "Cap fit", hint: "The cap telescopes over the body; clearance per side." },
    {
      id: "retrieval",
      title: "Retrieval",
      hint: "Thumb notch on the front and side recesses — both stay hidden under the closed cap.",
    },
    { id: "sheet", title: "Sheet" },
  ],
  presets: [DECK_PRESETS, SLEEVE_PRESETS, MATERIAL_PRESETS],
  onChange: () => {
    store.save(params);
    rebuild();
    updateReadout();
  },
});

viewSelect.addEventListener("change", () => {
  rebuild();
  viewer.frameCamera([modelGroup]);
});

document.getElementById("reset")!.addEventListener("click", () => {
  Object.assign(params, store.defaults);
  store.clear();
  panel.sync();
  rebuild();
  updateReadout();
  viewer.frameCamera([modelGroup]);
});

document.getElementById("downloadSvg")!.addEventListener("click", () => {
  const l = layout(params);
  l.sheets.forEach((sheet, i) => {
    const suffix = l.sheets.length === 1 ? "" : `-sheet-${i + 1}`;
    downloadText(`${filenameStem(params)}${suffix}.svg`, sheetSvg(sheet, params), "image/svg+xml");
  });
});

rebuild();
updateReadout();
viewer.frameCamera([modelGroup]);
viewer.start();

installAppHook({
  params,
  rebuild,
  render: viewer.render,
  frame: () => viewer.frameCamera([modelGroup]),
  canvas: viewer.renderer.domElement,
});
