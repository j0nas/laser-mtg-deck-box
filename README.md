# Laser-cut MTG deck box — parametric builder

A browser-based parametric builder for a **laser-cut** Magic: The Gathering deck box: a
finger-jointed box holding a vertical stack of (sleeved) cards, closed by a **lid that slides in
hidden grooves** — the sides are laminated (an inner layer carrying the groove profile glued to a
full outer layer), so the box reads as clean solid walls with a sunken sliding top and a pull
hole. Eight flat panels, nested onto your sheet and exported as real-millimetre SVG cut files —
the default Commander box fits a single 300 × 300 mm sheet of 1/8″ basswood ply.

Built on [parametric-kit](../parametric-kit): the control panel derives entirely from the param
schema, and the 3D preview extrudes the exact outlines the SVGs cut, so the box matches what you
see.

## Run it

```bash
vp install      # or: pnpm install
vp dev          # http://localhost:5173
vp build        # production build → dist/
vp check        # format + lint + typecheck
pnpm test       # 36 geometry/layout/schema tests (never a globally-installed vp)
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
  kerf set the glide — the lid is the one part you never glue.
- **Sheet** — shelf-packed layout with a part gap, multi-sheet when needed, oversize panels
  reported instead of silently dropped. One SVG per sheet, hairline red strokes, `id` per panel.

## How it works

| File            | Responsibility                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| `src/params.ts` | Kit schema, presets, `dims()` derived dimensions — the single source of truth |
| `src/panels.ts` | Pure `Params → Panel[]`: outlines with joints/kerf + assembled placement      |
| `src/svg.ts`    | Shelf packing onto sheets + real-mm SVG rendering                             |
| `src/main.ts`   | Kit wiring: schema panel, viewer, readout, SVG downloads                      |
