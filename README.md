# Laser-cut MTG deck box — parametric builder

A browser-based parametric builder for a **laser-cut** Magic: The Gathering deck box: a
finger-jointed box holding a vertical stack of (sleeved) cards, closed by a **lid that slides in
hidden grooves** — the sides are laminated (an inner layer carrying the groove profile glued to a
full outer layer), so the box reads as clean solid walls with a sunken sliding top. A **lid
frame** laminates onto the lid in turn: a picture-frame ninth panel whose ornamented window
recesses the foil marque behind a charred border, sits flush with the box top, and doubles as the
pull. Nine flat panels, nested onto your sheet and exported as real-millimetre SVG cut files —
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
pnpm test       # 92 geometry/layout/schema/marque tests (never a globally-installed vp)
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
  so it costs no material.
- **Sheet** — shelf-packed layout with a part gap, multi-sheet when needed, oversize panels
  reported instead of silently dropped. The **lid is pinned to sheet 1's bottom-left corner**
  (`partGap` in from both edges), so the foil patch always goes on the same known corner of the
  raw sheet — the readout states the minimum patch size. One SVG per sheet, hairline red strokes,
  `id` per panel.

## Lid foil marque

The lid can carry an **all-vector commander marque**, laid out parametrically from `dims()` and the
pull-hole spec, confined to the frame's window (or, frame off, the visible lid zone — 3.05 mm
hides in each side groove) and kept ≥ 1.5 mm clear of the pull cut. Type a commander, press
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

Prep and calibration: sand the lid face to **320 grit** before foiling (foil bonds best on smooth
wood), run a small **test grid** of power/speed squares on scrap of the same sheet first, and keep
foil features ≥ **0.4 mm** — the generator enforces this floor everywhere, healing included. The
cut layer (`#ff0000`) is untouched by the marque, and no marque colour collides with it.

## How it works

| File              | Responsibility                                                                        |
| ----------------- | ------------------------------------------------------------------------------------- |
| `src/params.ts`   | Kit schema, presets, `dims()` derived dimensions — the single source of truth         |
| `src/panels.ts`   | Pure `Params → Panel[]`: outlines with joints/kerf + placement, `pullHole`, `capSpec` |
| `src/lidart.ts`   | Pure marque layout: `Params + LidArt → pass-tagged, lid-local foil elements`          |
| `src/heal.ts`     | Pure vector morphology: glyph flattening + Clipper booleans/offsets → healed coins    |
| `src/scryfall.ts` | Browser Scryfall helpers: card lookup + mana-symbol glyph fetch                       |
| `src/svg.ts`      | Sheet packing (lid pinned to the foil corner) + real-mm SVG + marque layer mapping    |
| `src/main.ts`     | Kit wiring: schema panel, viewer, readout, SVG downloads, marque UI + overlay         |
