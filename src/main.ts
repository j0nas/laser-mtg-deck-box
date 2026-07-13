// App entry: wires the kit's schema-driven panel, viewer and download helpers around this app's
// pure geometry (panels.ts) and sheet layout (svg.ts). The 3D preview and the exported SVGs are
// built from the same outlines.

import * as opentype from "opentype.js";
import { downloadText } from "parametric-kit/export";
import { createStore, installPanelCollapse, renderPanel } from "parametric-kit/params";
import { createViewer, installAppHook } from "parametric-kit/viewer";
import {
  CanvasTexture,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Shape,
  SRGBColorSpace,
  type Texture,
} from "three";
import fontUrl from "./assets/Cinzel-Bold.ttf?url";
import manaSymbols from "./assets/mana-symbols.json";
import {
  DEFAULT_LID_ART,
  type LidArt,
  type LidArtElement,
  type LidArtPass,
  layoutLidArt,
  type PassMode,
  sanitizeLidArt,
  sortPips,
} from "./lidart.ts";
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
import { autocompleteCards, fetchSymbolPaths, lookupCard } from "./scryfall.ts";
import { filenameStem, layout, type LidArtSheet, sheetSvg, totalPanelArea } from "./svg.ts";

const store = createStore(schema, { key: "laser-mtg-deck-box:params", version: 2 });
const params: Params = store.load();

// --- lid foil marque: an app-owned config with its own persisted blob ------------------------
//
// This is NOT a kit schema param (the kit only knows num/pick/toggle, and a string-array / glyph
// map must not dirty presets), so it gets its own store; sanitizeLidArt (lidart.ts) applies the
// same strictness as the kit's sanitize and silently drops keys from older blob shapes.
const LIDART_KEY = "laser-mtg-deck-box:lidart:v1";

function loadLidArt(): LidArt {
  try {
    const raw = localStorage.getItem(LIDART_KEY);
    return sanitizeLidArt(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_LID_ART, pips: [], symbolPaths: {} };
  }
}

function saveLidArt(): void {
  try {
    localStorage.setItem(LIDART_KEY, JSON.stringify(art));
  } catch {
    /* private mode / storage full — keep the in-memory config */
  }
}

const art: LidArt = loadLidArt();
let font: opentype.Font | null = null;

// The bundled WUBRGC glyphs guarantee the coins render offline and on first paint; a Scryfall
// lookup refreshes/persists them (persisted paths win, so a stored blob round-trips unchanged).
const BUNDLED_SYMBOLS = manaSymbols as Record<string, string>;

// One vector source: the same element list feeds the SVG export and the 3D preview overlay.
function lidArtElements(): LidArtElement[] {
  if (!art.enabled) return [];
  const cfg: LidArt = { ...art, symbolPaths: { ...BUNDLED_SYMBOLS, ...art.symbolPaths } };
  return layoutLidArt(params, cfg, { font });
}

const viewer = createViewer(document.getElementById("app")!);

type ViewMode = "closed" | "open" | "flat";
const viewSelect = document.getElementById("viewMode") as HTMLSelectElement;
const viewMode = (): ViewMode => viewSelect.value as ViewMode;

// Preview tints per sheet material: `face` is the sheet surface, `edge` the laser-cut end grain
// (charred a shade darker in real life) — ExtrudeGeometry splits caps vs walls into material
// groups, so every finger, tab and groove mouth outlines itself exactly like the physical box.
const TINTS: Record<string, { face: number; edge: number }> = {
  "1/8″ basswood ply": { face: 0xdcbd8e, edge: 0xa57d4f },
  "3mm MDF": { face: 0xb59a7a, edge: 0x74604c },
  "1/8″ acrylic": { face: 0xa9c8e0, edge: 0x7fa3bf },
};

const modelGroup = new Group();
viewer.scene.add(modelGroup);

const explodeEl = document.getElementById("explode") as HTMLInputElement;

// Per-panel explode directions: the floor drops, the lid rises (the frame further, so the lid
// lamination separates just like the sides'), walls move off their faces — and the two layers of
// each side separate, showing the groove lamination that is otherwise hidden.
const EXPLODE_DIR: Record<string, [number, number, number]> = {
  "body-floor": [0, 0, -1],
  lid: [0, 0, 1],
  "lid-cap": [0, 0, 1.6],
  "body-front": [0, -1, 0],
  "body-back": [0, 1, 0],
  "side-left-outer": [-1.7, 0, 0],
  "side-left-inner": [-0.85, 0, 0],
  "side-right-inner": [0.85, 0, 0],
  "side-right-outer": [1.7, 0, 0],
};

function panelMesh(panel: Panel, matrix: Matrix4, face: number, edge: number): Mesh {
  const shape = new Shape();
  panel.outline.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  for (const hole of panel.holes) {
    const path = new Path();
    hole.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new ExtrudeGeometry(shape, { depth: params.thickness, bevelEnabled: false });
  // Material group 0 = the two sheet faces, group 1 = the cut walls (end grain).
  const mesh = new Mesh(geo, [
    new MeshStandardMaterial({ color: face, roughness: 0.85, metalness: 0 }),
    new MeshStandardMaterial({ color: edge, roughness: 0.9, metalness: 0 }),
  ]);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrix);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- lid marque preview overlay --------------------------------------------------------------
//
// The marque is drawn once onto an offscreen canvas (Path2D over the SAME path-data strings the SVG
// exports) and mapped onto a thin transparent plane a hair above the lid's top face, added as a
// CHILD of the lid mesh so it follows the lid through closed/open/explode/flat views.
const PREVIEW_TINT: Record<LidArtPass, string> = {
  foilGold: "#d4a947",
  engrave: "#3a2a1a",
};

// Single-pass = one physical foil, so preview everything in the gold tint; multi = per-pass tints
// (the coin glyphs sit on the dark-engrave layer inside their gold discs).
function previewColor(pass: LidArtPass, mode: PassMode): string {
  return mode === "single" ? PREVIEW_TINT.foilGold : PREVIEW_TINT[pass];
}

const PREVIEW_PPM = 12;

function drawMarqueCanvas(
  canvas: HTMLCanvasElement,
  els: LidArtElement[],
  mode: PassMode,
  lidW: number,
  lidL: number,
): void {
  const W = Math.max(1, Math.round(lidW * PREVIEW_PPM));
  const H = Math.max(1, Math.round(lidL * PREVIEW_PPM));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  // All-vector marque: Path2D consumes the very path-data strings the SVG exports, in lid-local mm
  // mapped y-up into the canvas. Element order = paint order (multi-mode coin glyphs over discs).
  ctx.setTransform(PREVIEW_PPM, 0, 0, -PREVIEW_PPM, 0, H);
  for (const el of els) {
    if (el.paths.length === 0) continue;
    ctx.fillStyle = previewColor(el.pass, mode);
    ctx.fill(new Path2D(el.paths.join("")), el.fillRule);
  }
}

// Build the overlay plane for the lid, in the lid's LOCAL frame (outline in x,y extruded +z to t).
function addMarque(lidMesh: Mesh, els: LidArtElement[]): void {
  if (els.length === 0) return;
  const d = dims(params);
  const canvas = document.createElement("canvas");
  drawMarqueCanvas(canvas, els, art.passMode, d.lidW, d.lidL);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });
  const plane = new Mesh(new PlaneGeometry(d.lidW, d.lidL), mat);
  plane.position.set(d.lidW / 2, d.lidL / 2, params.thickness + 0.06);
  plane.matrixAutoUpdate = true;
  lidMesh.add(plane);
}

function rebuild(): void {
  const old = modelGroup.children.slice();
  modelGroup.clear();
  for (const child of old) {
    child.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        const map = (m as { map?: Texture | null }).map;
        if (map) map.dispose();
        m.dispose();
      }
    });
  }

  const tint = TINTS[materialFor(params.thickness).name] ?? TINTS["1/8″ basswood ply"]!;
  const lidFace = tint.face - 0x181818; // all tints keep every channel above 0x18, so this never wraps
  const artEls = lidArtElements();

  const addPanel = (panel: Panel, m: Matrix4): void => {
    const mesh = panelMesh(panel, m, panel.id === "lid" ? lidFace : tint.face, tint.edge);
    if (panel.id === "lid") addMarque(mesh, artEls);
    modelGroup.add(mesh);
  };

  if (viewMode() === "flat") {
    const l = layout(params);
    let ox = 0;
    for (const sheet of l.sheets) {
      for (const { panel, x, y } of sheet.placements) {
        addPanel(
          panel,
          new Matrix4().makeTranslation(ox + x, params.sheetH - y - panel.size[1], 0),
        );
      }
      ox += params.sheetW + 25;
    }
  } else {
    // "open" slides the lid most of the way out of its grooves, toward the viewer — the frame is
    // glued to it, so it rides along.
    const d = dims(params);
    const slide = viewMode() === "open" ? -0.72 * d.lidL : 0;
    const explode = Number(explodeEl.value) * 0.45 * Math.max(d.outerW, d.outerD, d.wallH);
    for (const panel of panels(params)) {
      const m = new Matrix4().fromArray(placeMatrix(panel.place));
      const [ex, ey, ez] = EXPLODE_DIR[panel.id] ?? [0, 0, 0];
      const slideY = panel.id === "lid" || panel.id === "lid-cap" ? slide : 0;
      if (slideY !== 0 || explode > 0) {
        m.premultiply(
          new Matrix4().makeTranslation(ex * explode, ey * explode + slideY, ez * explode),
        );
      }
      addPanel(panel, m);
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
    `Closed box: <b>${d.outerW.toFixed(1)} × ${d.outerD.toFixed(1)} × ${d.assembledH.toFixed(1)} mm</b>`,
    `Fits <b>${capacity(params)}</b> cards (deck ${params.cardCount} + ${params.extraCards} spare)`,
    `${mat.name} · ~${grams} g · <b>${l.sheets.length}</b> sheet${l.sheets.length === 1 ? "" : "s"} of ${params.sheetW}×${params.sheetH}`,
    // The lid is pinned to sheet 1's bottom-left corner (see layout()), so the foil patch can go
    // on the raw sheet before cutting: it must reach gap + lid size in from that corner.
    ...(art.enabled
      ? [
          `Foil: cover the sheet's bottom-left corner ≥ <b>${Math.ceil(params.partGap + d.lidW)} × ${Math.ceil(params.partGap + d.lidL)} mm</b> (lid is pinned there)`,
        ]
      : []),
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

// Accordion sections group the schema by task: what you store (deck), what you retune after a test
// cut (fit), the openings you choose once (retrieval + frame), and the machine side (material +
// sheet). Only the deck section starts open; COLLAPSE_KEY remembers what the user opens. The
// title-less cap/sheet groups continue the preceding section, keeping their own hints/visibility.
const COLLAPSE_KEY = "laser-mtg-deck-box:collapse:v1";
const panel = renderPanel(document.getElementById("controls")!, schema, params, {
  collapsible: { key: COLLAPSE_KEY },
  groups: [
    { id: "cards", title: "Deck & cards", presets: ["deck", "sleeve"], open: true },
    {
      id: "fit",
      title: "Fit & clearances",
      hint: "Air around the card stack, plus the sliding fit: the lid glides in hidden grooves, clearance plus kerf sets the glide, and the same clearance sizes the lid frame against the recess walls — laminating with the lid parked in the box self-centres the frame. The latch is a spring cut into each groove that clicks into the lid's edge; raise the bump for a harder click.",
    },
    {
      id: "retrieval",
      title: "Retrieval & lid frame",
      hint: "A finger in the pull hole slides the lid open; the hole doubles as a peek at the top card. The thumb notch scallops a wall's top edge so a thumb can drag the stack up — on the back wall it cuts deeper to reach the same card depth; a back notch leaves a small gap behind the closed lid.",
    },
    {
      id: "cap",
      hint: "The frame is a ninth panel glued onto the sunken lid: a picture frame whose window recesses the marque behind a charred border and sits flush with the box top (the rail strips shrink to make room). The window wears a legendary crown arch at the back and cathedral cusps in the corners; a thumb in it catches the front edge — widened by the scallop — and drags the lid open. Frame too small for a window and it drops from the cut.",
    },
    {
      id: "material",
      title: "Material & cutting",
      presets: ["material"],
      hint: (p) =>
        `Cut from ${materialFor(p.thickness).name}. Kerf grows every finger into a press-fit; ` +
        `fingers aim for ${p.fingerWidth} mm.`,
    },
    { id: "sheet" },
  ],
  presets: [DECK_PRESETS, SLEEVE_PRESETS, MATERIAL_PRESETS],
  onChange: () => {
    store.save(params);
    rebuild();
    updateReadout();
  },
});

// The whole panel collapses to its title bar so the preview is workable on phones — where it also
// starts collapsed, since a 300px overlay covers most of a small viewport.
const panelBox = document.getElementById("panel")!;
installPanelCollapse(panelBox, panelBox.querySelector("h1")!, {
  startCollapsed: window.matchMedia("(max-width: 640px)").matches,
});

// The hand-written sections (#lidart, #view) join the kit accordion's persisted blob under their
// element ids, so one key remembers the whole panel — kit-rendered and app-owned sections alike.
function collapseState(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "null");
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {}; // storage disabled or bad JSON -> the markup's default open states
  }
}
for (const details of document.querySelectorAll<HTMLDetailsElement>("#panel > details.group")) {
  const saved = collapseState()[details.id];
  if (typeof saved === "boolean") details.open = saved;
  details.addEventListener("toggle", () => {
    try {
      localStorage.setItem(
        COLLAPSE_KEY,
        JSON.stringify({ ...collapseState(), [details.id]: details.open }),
      );
    } catch {
      /* private mode / storage full — the section still toggles */
    }
  });
}

viewSelect.addEventListener("change", () => {
  rebuild();
  viewer.frameCamera([modelGroup]);
});

explodeEl.addEventListener("input", rebuild); // view state only: no persist, no readout change

document.getElementById("reset")!.addEventListener("click", () => {
  Object.assign(params, store.defaults);
  store.clear();
  panel.sync();
  rebuild();
  updateReadout();
  viewer.frameCamera([modelGroup]);
});

function currentArtSheet(): LidArtSheet | undefined {
  return art.enabled ? { elements: lidArtElements(), mode: art.passMode } : undefined;
}

function exportSvgs(): string[] {
  const artSheet = currentArtSheet();
  return layout(params).sheets.map((sheet) => sheetSvg(sheet, params, artSheet));
}

document.getElementById("downloadSvg")!.addEventListener("click", () => {
  const l = layout(params);
  const artSheet = currentArtSheet();
  l.sheets.forEach((sheet, i) => {
    const suffix = l.sheets.length === 1 ? "" : `-sheet-${i + 1}`;
    downloadText(
      `${filenameStem(params)}${suffix}.svg`,
      sheetSvg(sheet, params, artSheet),
      "image/svg+xml",
    );
  });
});

// --- lid marque UI ---------------------------------------------------------------------------

const laEnable = document.getElementById("laEnable") as HTMLInputElement;
const laName = document.getElementById("laName") as HTMLInputElement;
const laLookup = document.getElementById("laLookup") as HTMLButtonElement;
const laSuggest = document.getElementById("laSuggest") as HTMLUListElement;
const laMode = document.getElementById("laMode") as HTMLSelectElement;
const laUniform = document.getElementById("laUniform") as HTMLInputElement;
const laStatus = document.getElementById("laStatus")!;

laEnable.checked = art.enabled;
laName.value = art.name;
laMode.value = art.passMode;
laUniform.checked = art.uniformPips;

function setStatus(msg: string, err = false): void {
  laStatus.textContent = msg;
  laStatus.classList.toggle("err", err);
}

function refreshStatus(): void {
  if (art.name) {
    const pips = art.pips.length > 0 ? ` · ${art.pips.join(" ")}` : "";
    setStatus(`${art.name}${pips}`);
  } else {
    setStatus("Type a commander and press Look up.");
  }
}
refreshStatus();

async function doLookup(): Promise<void> {
  const q = laName.value.trim();
  if (!q) return;
  laLookup.disabled = true;
  setStatus("Looking up…");
  try {
    const card = await lookupCard(q);
    art.name = card.name;
    art.pips = sortPips(card.colorIdentity);
    art.enabled = true;
    laEnable.checked = true;
    laName.value = card.name;
    // The symbol glyphs ship in the export, so persist them with the config (bundled WUBRGC
    // glyphs already cover the first paint; fetched ones refresh/extend them).
    const fetched = await fetchSymbolPaths(card.colorIdentity);
    Object.assign(art.symbolPaths, fetched);
    saveLidArt();
    rebuild();
    updateReadout(); // a lookup enables the marque, which adds the foil-corner line
    refreshStatus();
  } catch (e) {
    setStatus((e as Error).message || "Lookup failed.", true);
  } finally {
    laLookup.disabled = false;
  }
}

laEnable.addEventListener("change", () => {
  art.enabled = laEnable.checked;
  saveLidArt();
  rebuild();
  updateReadout(); // the foil-corner line appears/disappears with the marque
});
// --- commander name autocomplete --------------------------------------------------------------
// Debounced Scryfall suggestions under the name input. In-flight requests are aborted on every
// new keystroke, and a response only renders if the input still matches the query it answered.

const AC_DEBOUNCE_MS = 250;
let acItems: string[] = [];
let acActive = -1; // keyboard-highlighted suggestion, -1 = none
let acTimer: ReturnType<typeof setTimeout> | undefined;
let acAbort: AbortController | null = null;
const acCache = new Map<string, string[]>();

function closeSuggest(): void {
  clearTimeout(acTimer);
  acAbort?.abort();
  acAbort = null;
  acItems = [];
  acActive = -1;
  laSuggest.hidden = true;
  laSuggest.innerHTML = "";
  laName.setAttribute("aria-expanded", "false");
  laName.removeAttribute("aria-activedescendant");
}

function markActive(): void {
  [...laSuggest.children].forEach((li, i) => {
    li.classList.toggle("active", i === acActive);
    li.setAttribute("aria-selected", String(i === acActive));
  });
  if (acActive >= 0) {
    laName.setAttribute("aria-activedescendant", `laOpt${acActive}`);
    laSuggest.children[acActive].scrollIntoView({ block: "nearest" });
  } else {
    laName.removeAttribute("aria-activedescendant");
  }
}

function showSuggest(names: string[]): void {
  acItems = names;
  acActive = -1;
  laSuggest.innerHTML = "";
  names.forEach((name, i) => {
    const li = document.createElement("li");
    li.id = `laOpt${i}`;
    li.setAttribute("role", "option");
    li.textContent = name;
    // mousedown (not click) so the pick lands before the input's blur closes the list
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pickSuggestion(name);
    });
    laSuggest.append(li);
  });
  laSuggest.hidden = names.length === 0;
  laName.setAttribute("aria-expanded", String(names.length > 0));
}

function pickSuggestion(name: string): void {
  laName.value = name;
  art.name = name;
  closeSuggest();
  void doLookup();
}

async function fetchSuggest(q: string): Promise<void> {
  const key = q.toLowerCase();
  const cached = acCache.get(key);
  if (cached) {
    showSuggest(cached);
    return;
  }
  acAbort?.abort();
  acAbort = new AbortController();
  try {
    const names = await autocompleteCards(q, acAbort.signal);
    if (acCache.size > 100) acCache.clear();
    acCache.set(key, names);
    if (laName.value.trim() === q) showSuggest(names);
  } catch {
    /* aborted by a newer keystroke, or network hiccup — leave the list as is */
  }
}

function scheduleSuggest(): void {
  clearTimeout(acTimer);
  const q = laName.value.trim();
  if (q.length < 2) {
    closeSuggest();
    return;
  }
  acTimer = setTimeout(() => void fetchSuggest(q), AC_DEBOUNCE_MS);
}

laName.addEventListener("input", () => {
  art.name = laName.value;
  saveLidArt();
  if (art.enabled) rebuild();
  scheduleSuggest();
});
laName.addEventListener("keydown", (e) => {
  if (!laSuggest.hidden) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Cycle through the options with a "none highlighted" stop between last and first, so
      // Enter can still submit the typed text as-is.
      const last = acItems.length - 1;
      if (e.key === "ArrowDown") acActive = acActive >= last ? -1 : acActive + 1;
      else acActive = acActive <= -1 ? last : acActive - 1;
      markActive();
      return;
    }
    if (e.key === "Escape") {
      closeSuggest();
      return;
    }
    if (e.key === "Enter" && acActive >= 0) {
      e.preventDefault();
      pickSuggestion(acItems[acActive]);
      return;
    }
    if (e.key === "Tab") closeSuggest();
  }
  if (e.key === "Enter") {
    closeSuggest();
    void doLookup();
  }
});
laName.addEventListener("blur", () => closeSuggest());
laLookup.addEventListener("click", () => void doLookup());
laMode.addEventListener("change", () => {
  art.passMode = laMode.value as PassMode;
  saveLidArt();
  rebuild();
});
laUniform.addEventListener("change", () => {
  art.uniformPips = laUniform.checked;
  saveLidArt();
  rebuild();
});

// Load the bundled display face (name outlining); re-render once it arrives.
opentype.load(fontUrl, (err, f) => {
  if (err || !f) {
    if (art.enabled && art.name)
      setStatus(`${art.name} — display font failed to load; name omitted.`, true);
    return;
  }
  font = f;
  if (art.enabled) rebuild();
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
  art,
  elements: lidArtElements,
  exportSvgs,
  lookup: (name: string) => {
    laName.value = name;
    return doLookup();
  },
});
