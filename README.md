# Laser-cut MTG deck box — parametric builder

A browser-based parametric builder for a **laser-cut** Magic: The Gathering deck box: a
finger-jointed box holding a vertical stack of (sleeved) cards, closed by a **lid that slides in
hidden grooves** — the sides are laminated (an inner layer carrying the groove profile glued to a
full outer layer), so the box reads as clean solid walls with a sunken sliding top. A **lid
frame** laminates onto the lid in turn: a ninth panel flush with the box top, either a picture
frame whose ornamented window recesses the foil marque behind a charred border and doubles as the
pull, or a **solid face** that carries the marque on top — engraved, foiled, or pierced clean
through as fretwork. Nine flat panels, nested onto your sheet and exported as real-millimetre SVG cut files —
the default Commander box fits a single 300 × 300 mm sheet of 1/8″ basswood ply (measured 3 mm).

Built on [parametric-kit](../parametric-kit): the control panel derives entirely from the param
schema, and the 3D preview extrudes the exact outlines the SVGs cut, so the box matches what you
see.

## Run it

```bash
vp install      # or: pnpm install
vp dev          # http://localhost:5173
vp build        # production build → dist/
vp check        # format + lint + typecheck
pnpm test       # 147 geometry/layout/schema/art tests (never a globally-installed vp)
```

## The design

- **Cards** — cavity sized from `cardCount × cardThickness` plus token headroom (10 cards'
  worth by default) and clearances; sleeve presets (unsleeved/penny/standard/double) and deck
  presets (40/60/75/100) match the 3D-printed sibling app.
- **Material** — preset pick (1/8″ basswood ply default, 3 mm MDF, 1/8″ acrylic) drives sheet
  thickness and the weight estimate; thickness is a free slider for anything else.
- **Joinery** — box joints everywhere: the front/back walls' fingers pass 2t deep through both
  side layers; floor tabs pass through the walls and finish flush outside. Finger width is a
  target; each edge gets the largest odd comb count that keeps segments ≥ 60 % of it. The two
  layers of each side are identical parts.
- **Kerf** — every internal finger/slot boundary shifts kerf/2 toward the slot, so joints
  press-fit while panel envelopes stay exactly nominal. Kerf 0 warns (joints would cut loose).
- **Lid** — slides front-to-back, stops against the back wall, rests flush on the front wall's
  top edge; a pull hole opens it one-handed. Slide clearance (`lidFit`) plus the laser's natural
  kerf set the glide — the lid is the one part you never glue to the box. A **flex latch** clicks
  it shut: each groove hides a cantilever spring (a U-slot cut in the inner layer) whose nub pops
  into a notch in the lid's edge; `latchBump` tunes the click, 0 removes it, and tiny boxes drop
  it automatically.
- **Lid frame** — a joint-free picture frame glued onto the sunken lid (the recess jigs it:
  slide the lid in, centre the frame, front edges flush). With it on, the rail strips shrink to
  `t − lidFit` so the frame's top face lands **flush with the box top**; its window recesses the
  marque one thickness deep behind a charred border and its front edge is the working pull — a
  thumb drops in and drags the lid open. The window wears free-cut ornament: a **legendary crown
  arch** risen into the back rail, **cathedral cusps** in the corners, and a thumb **scallop** in
  the front rail. Rail width 0 removes it; a window below 16 mm drops the whole frame (and the
  flush shrink) automatically. It packs into the sheet cell the old eight-panel layout left empty,
  so it costs no material. The **frame face** param swaps all of that for a **solid face**: no
  window (the minimum-window rule is waived, so small boxes qualify too), the marque rides the
  frame's top face, and the pull moves — the **pull hole drills through frame and lid** as one
  aligned finger hole, and/or the **scallop becomes a thumb well** cut through the frame just
  behind its front edge: the well's flat front wall is the bar a thumb hooks to drag the lid open
  (the lid opens toward you, so an open-front notch would give the thumb nothing to pull
  against), and its floor is the lid's own top face. Both pulls are optional; with both off (and
  no wall thumb notch to grip the lid by) the readout warns.
- **Sheet** — shelf-packed layout with a part gap, multi-sheet when needed, oversize panels
  reported instead of silently dropped. The **marque panel is pinned to sheet 1's bottom-left
  corner** (`partGap` in from both edges) — the lid, or the frame when its face is solid — so the
  foil patch always goes on the same known corner of the raw sheet; the readout states the
  minimum patch size. One SVG per sheet, hairline red strokes, `id` per panel.

## Lid marque — gold foil, all wood, or fretwork

The lid can carry an **all-vector commander marque**, laid out parametrically from `dims()` and the
pull-hole spec, confined to the frame's window (or the solid frame face, or, frame off, the
visible lid zone — 3.05 mm hides in each side groove) and kept ≥ 1.5 mm clear of the pull cut.
With the solid frame face the marque rides the **frame's top face** in cap-local coordinates —
`marquePanel()` routes the export, the preview overlay and the sheet pinning to whichever panel
carries it. Type a commander, press
**Look up**, and [Scryfall](https://scryfall.com) resolves the exact name and colour identity.
Back to front the marque stacks: a legendary **crown**, the **name split at its first comma** —
the primary name set large (~10 mm, auto-shrunk to fit), the epithet at ~45 % beneath, both in
outlined Cinzel caps between two rules — and a **mana orbit** of colour-identity coins arcing
around the pull hole. With the frame off, a double-pinstripe **border** wraps the composition;
with it on, the frame's charred window edge is the border, and a **frame trace** takes the foil
layer instead: a thin band whose outer boundary is the exact window cut, so you can peel the foil
patch away outside it and glue the frame ring wood-on-wood — what stays reads as a gold pinstripe
echoing the arch, cusps and scallop. One vector source drives
the 3D preview, the SVG export and the tests, so the preview is the cut. Every element is a closed,
filled region (LightBurn ignores stroke width and `<text>`); the name is outlined via opentype.js
from a bundled OFL **Cinzel Bold** (`src/assets/`). The lid is engraved on its as-cut top face,
which is the assembled box's visible top face (its place rotation is identity), so **no mirroring**
is applied.

The **mana coins** ship the real Scryfall symbol art: each coin is a gold disc with the glyph
knocked out — bare wood against foil, the robust polarity, since an unbonded sliver inside a bonded
field peels away with the carrier sheet while tiny bonded islands lift. Manufacturability at any
size is guaranteed by **vector morphological healing** (`heal.ts`, Clipper booleans + offsets):
sub-floor glyph detail is minimally thickened and sub-floor foil slivers absorbed, like font
hinting for the laser. Coins run ~14 mm Ø for 1–3 colour identities down to ~9 mm for five; on
short lids they shrink to 6 mm before the orbit drops, then the epithet drops, then the name
shrinks, then the crown goes.

The **lid finish** select offers the marque in three looks. **Gold foil** is the composition
above. **Engraved (all wood)** chars the identical composition directly into the marque face — no
foil, no extra pass: every element lands on the dark-engrave layer, and the coins trade the
knockout disc for a thin engraved **ring with the glyph engraved dark** inside it (a solid charred
disc would read as a printed decal on bare wood). The layout, degradation ladder and keep-outs are
shared, so switching finish never re-flows a marque — and the foil glue-peel trace simply drops,
since the frame's charred window edge already draws that line physically.

**Pierced (fretwork)** needs the **solid frame face** behind it — the lid backs the frame, so the
openings show its wood one thickness down in shadow and never open into the card cavity — and
cuts the marque's island-free bold ornament clean through the frame: the **crown** (its
overlapping subpaths unioned into disjoint outlines, so nothing double-cuts) and the **name
rules** (thickened to 0.8 mm so the freed slivers drop instead of wedging back). Everything with
interior detail stays engraved on top, and that split is deliberate: cut text sheds its counters
(the island inside every A, O or R falls out with the scrap) and its sub-half-millimetre serif
webs char away at these cap heights, and a cut coin ring drops its centre disc — so name,
epithet, coins and border char while only the shapes that survive piercing pierce. Without the
solid face the option greys out and a stored pierced config quietly engraves. In the 3D preview
the cutouts are real holes in the frame mesh — flattened from the same path data the export cuts
— so pierced and engraved look as different on screen as they do in wood.

### Foil workflows

The export tags each element with a semantic pass; the **workflow mode** maps passes to LightBurn
layers at export time. Never move the sheet between passes — the cut runs last so it always
registers to the marque.

- **Single-pass patch (default).** Adhere one foil patch over the lid region — always the sheet's
  bottom-left corner, patch size in the readout — run **one** job, peel
  once, cut releases the lid. Everything — crown, name, coins, pinstripes — lands on the one
  foil layer (blue `#0000ff`); the foil colour is your physical choice at the machine, so the file
  is identical whichever foil you lay down.
- **Multi-pass.** **Gold foil** pass (`#0000ff`), then the cut, with the coin glyphs split onto the
  **dark-engrave** layer (`#000000`) inside solid gold discs — engrave the glyphs dark first at high
  power, then the foil pass bonds the disc around (not in) the charred recess: a gold coin with a
  dark symbol, the closest match to the printed card.

Prep and calibration: sand the marque face to **320 grit** before foiling (foil bonds best on
smooth wood), run a small **test grid** of power/speed squares on scrap of the same sheet first,
and keep foil features ≥ **0.4 mm** — the generator enforces this floor everywhere, healing
included. Foil and engrave colours never collide with the cut layer (`#ff0000`); only the pierced
finish adds marque shapes to it deliberately, as the real through-cuts they are.

## Side engravings

The four visible walls can wear an engraved pattern (`sideart.ts`), styled after what actually
looks crafted on bare wood — thin engraved linework, never filled areas (lines char crisp and
raster in minutes; filled fields char muddy for an hour). Two layouts share the engine. **Framed**
(the default): every wall gets a thin **border pinstripe** riding one uniform margin inside the
finger joints, and the chosen pattern fills the field inside it; on a wall with a thumb notch,
border and pattern both **route around the cut** (region difference against a dilated keep-out),
the same move as the lid frame's scallop. **Full bleed**: no border, no margins — the pattern is
cropped to the panel's real cut outline instead, so the linework runs to every cut edge and onto
the corner fingers (never onto slot scrap), and the notch bites the pattern like any other cut.
Either way the pattern is generated as centreline geometry, stroked into closed bands (LightBurn
ignores stroke-width) and cropped with one Clipper intersection.

The patterns:

- **Diamond lattice** — pinstripes at ±45°, the classic humidor treatment.
- **Chevron parquet** — stacked zigzag pinstripes with the peaks aligned in columns, the French
  parquet floor.
- **Herringbone twill** — columns of parallel ±45° ribs, adjacent columns mirrored and offset
  half a step: the broken-twill seam of woven cloth and parquet floors.
- **Arrow fletching (yabane)** — columns of nested feather chevrons between fine rules,
  adjacent columns opposed and half-stepped: the meisen-kimono classic.
- **Basketweave** — square cells of three strokes alternating warp and weft, the woven mat.
- **Greek key (meander)** — running-fret bands, each one continuous line folding into its
  hooks, bracketed by rail pinstripes: the carved-border classic.
- **Rising steam (tatewaku)** — vertical undulating lines, neighbours in antiphase so the gaps
  swell and pinch in alternating barrels: the Heian court-textile classic.
- **Guilloché braid** — engine turning's torsade: two antiphase sine strands per band crossing
  into a chain of lenses, bands stacked with the lenses bricked — the watchmaker's ornament.
- **Star & cross (khatam)** — the foundational Islamic tessellation with both voices drawn:
  eight-point stars (16-gon outline plus waist octagon) on a grid and a Greek cross in every
  void, separated by a grout-line gap like the ceramic originals.
- **Woven bamboo (kagome)** — three straight strand families at 60°, crossings kept pairwise,
  every strand woven over-under with real breaks — the tri-axial basket weave, solved by
  propagated alternation.
- **Stitch grid (hitomezashi)** — one-stitch sashiko: single dashes on a square grid whose
  row/column phase words make the persimmon-flower motif emerge from the crossings.
- **Deco sunburst** — rays bursting from a hub on the field's bottom edge over nested half-arcs,
  the rising-sun marquetry motif.
- **Gothic trellis (ogee)** — mirrored sine columns kissing into stacked pointed lanterns:
  gothic tracery by way of the Moroccan trellis, echoing the lid frame's cathedral cusps.
- **Ocean waves (seigaiha)** — the Japanese shingled wave fans as concentric-arc scales. Every
  interior scale shows the identical clipped silhouette, so it is built once as a master shape
  and stamped across the grid; only the boundary ring of stamps pays for clipping.
- **Hemp leaf (asanoha)** — the triangular star lattice, the classic laser-engraving pattern.
- **Tortoiseshell (kikko)** — the Japanese hexagon lattice; shared edges merge into one band.
- **Seven treasures (shippo)** — the Japanese interlocking circles, overlapping into four-petal
  flowers between curved diamonds.
- **Flowing dunes** — horizontal contour lines whose amplitude, wavelength and phase drift
  deterministically row by row, the organic counterpoint to the geometric set.
- **Mana monogram** — the commander's colour identity tiled like a luxury monogram canvas: the
  real Scryfall glyphs, small and row-staggered, cycling through the identity diagonally. Whole
  glyphs only — one that would cross the field edge or the notch keep-out is dropped, not
  cropped (an edge-cropped symbol engraves as debris).

All wall art rides the dark-engrave layer and is drawn **engrave-face-up**: assemble with every
engraved face outward. The back wall's blank is symmetric, so it simply flips over; the **left
outer layer is cut mirrored** for the same reason (its combs only fit the flipped way, so the part
self-jigs) — with engraving off, the mirrored blank is physically the same part as before.

## How it works

| File              | Responsibility                                                                        |
| ----------------- | ------------------------------------------------------------------------------------- |
| `src/params.ts`   | Kit schema, presets, `dims()` derived dimensions — the single source of truth         |
| `src/panels.ts`   | Pure `Params → Panel[]`: outlines with joints/kerf + placement, `pullHole`, `capSpec` |
| `src/lidart.ts`   | Pure marque layout: `Params + LidArt → pass-tagged foil/engrave/cut elements`         |
| `src/sideart.ts`  | Pure wall-art layout: framed or full-bleed engraved-pattern engine per decorated wall |
| `src/heal.ts`     | Pure vector morphology: glyph flattening + Clipper booleans/offsets → healed coins    |
| `src/scryfall.ts` | Browser Scryfall helpers: card lookup + mana-symbol glyph fetch                       |
| `src/svg.ts`      | Sheet packing (marque panel pinned to the foil corner) + real-mm SVG + art layers     |
| `src/main.ts`     | Kit wiring: schema panel, viewer, readout, SVG downloads, art UI + overlays           |
