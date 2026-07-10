// App entry stub. The param schema (src/params.ts) and panel geometry (src/panels.ts) built in this
// pass are consumed by two follow-on passes: SVG export/nesting, and the viewer + panel wiring. This
// file intentionally does nothing beyond keeping `vp check`/`vp build` green until that wiring lands.
import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <section style="padding: 2rem; max-width: 40rem; margin: 0 auto;">
    <h1>Laser-cut MTG deck box</h1>
    <p>Param schema + panel geometry are ready (see src/params.ts, src/panels.ts).
      Viewer/UI wiring and SVG export land in follow-up passes.</p>
  </section>
`;
