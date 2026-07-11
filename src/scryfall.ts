// Scryfall lookups for the lid marque. BROWSER ONLY — thin, typed fetch helpers; never imported by
// the tests. Resolves a commander name to its exact name and colour identity, and pulls the
// colour-symbol SVGs whose glyph paths become the foil mana coins (see lidart.ts / heal.ts).
//
// API shapes verified against a live response (2026): GET /cards/named?fuzzy=<q> returns { name,
// color_identity: string[] }; both are top-level even for double-faced layouts.
// GET /cards/autocomplete?q=<q> returns a catalog { object: "catalog", data: string[] } of up to
// 20 card names, and needs at least 2 query characters to return anything.

const API = "https://api.scryfall.com";
const SYMBOLS = "https://svgs.scryfall.io/card-symbols";

export type CardInfo = {
  name: string;
  colorIdentity: string[]; // e.g. ["W", "U", "B", "G"]
};

type NamedResponse = {
  object: string;
  name?: string;
  color_identity?: string[];
  details?: string;
};

// Resolve a (fuzzy) commander name. Throws with a friendly message on ambiguous / not-found so the
// UI can show it.
export async function lookupCard(query: string): Promise<CardInfo> {
  const res = await fetch(`${API}/cards/named?fuzzy=${encodeURIComponent(query.trim())}`);
  const data = (await res.json()) as NamedResponse;
  if (!res.ok || data.object === "error") {
    throw new Error(data.details || `Card not found: “${query}”`);
  }
  return {
    name: data.name ?? query,
    colorIdentity: data.color_identity ?? [],
  };
}

type CatalogResponse = {
  object: string;
  data?: string[];
};

// Card-name suggestions for a partial query. Returns [] on short queries or HTTP errors (the
// dropdown just stays empty); an abort rejects so the caller can tell it apart from "no matches".
export async function autocompleteCards(query: string, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await fetch(`${API}/cards/autocomplete?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as CatalogResponse;
  return data.object === "catalog" && Array.isArray(data.data) ? data.data : [];
}

// Fetch the glyph path (the SVG's LAST <path d> — the first is the background circle on symbols
// that carry one) for each symbol code, keyed by code. Symbols that fail to fetch/parse are simply
// omitted (the coin degrades to a plain disc until a later fetch succeeds).
export async function fetchSymbolPaths(codes: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(codes)].map(async (code) => {
      try {
        const res = await fetch(`${SYMBOLS}/${encodeURIComponent(code.toUpperCase())}.svg`);
        if (!res.ok) return;
        const svg = await res.text();
        const d = glyphPathData(svg);
        if (d) out[code] = d;
      } catch {
        /* ignore — coin falls back to a plain disc */
      }
    }),
  );
  return out;
}

function glyphPathData(svg: string): string | null {
  // DOMParser is available in the browser (the only place this module runs).
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const paths = doc.querySelectorAll("path");
  const last = paths[paths.length - 1];
  return last?.getAttribute("d") ?? null;
}
