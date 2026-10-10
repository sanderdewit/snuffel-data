#!/usr/bin/env node
/* ============================================================================
 * Snuffel — region outline for the basemap extract
 *
 * Writes tiles/region.geojson: the outlines of every country in
 * tools/countries.json (from Natural Earth, public domain), used by
 * `pmtiles extract --region` to cut just our countries out of the Protomaps
 * planet build. Real outlines keep Russia, Belarus, Turkey, North Africa and
 * the open sea out of the file. Polygons outside Europe are dropped (French
 * overseas departments etc.); the Canaries, Madeira and the Azores stay in.
 *
 * Usage: node tools/tiles-region.js   (re-run when the country list changes)
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson";
// ISO codes from countries.json, plus territories Natural Earth lists separately.
const EXTRA_ISO = ["je", "gg", "im", "sm", "va", "ax"];
const EXTRA_A3 = ["CYN"];   // northern Cyprus (whole island on the map)
const EUROPE = { s: 27, w: -32, n: 72, e: 45 };
const OUT = path.join(__dirname, "..", "tiles", "region.geojson");

const wanted = new Set(require("./countries.json").countries.map((c) => c.cc).concat(EXTRA_ISO));

function inEurope(polygon) {
  return polygon[0].every(([lon, lat]) => lat >= EUROPE.s && lat <= EUROPE.n && lon >= EUROPE.w && lon <= EUROPE.e);
}

(async () => {
  const r = await fetch(SOURCE);
  if (!r.ok) throw new Error("Natural Earth download failed: " + r.status);
  const world = await r.json();
  const polygons = [], found = new Set();
  for (const f of world.features) {
    const iso = String(f.properties.ISO_A2_EH || "").toLowerCase();
    if (!wanted.has(iso) && !EXTRA_A3.includes(f.properties.ADM0_A3)) continue;
    found.add(iso);
    const g = f.geometry;
    for (const p of g.type === "Polygon" ? [g.coordinates] : g.coordinates) if (inEurope(p)) polygons.push(p);
  }
  // Tiny states (e.g. Vatican) can be missing at this scale; they sit inside a
  // neighbour's outline and its tiles, so that's fine - but report it.
  const missing = [...wanted].filter((c) => !found.has(c));
  const region = { type: "FeatureCollection", features: [{ type: "Feature", properties: { countries: [...wanted].sort() }, geometry: { type: "MultiPolygon", coordinates: polygons } }] };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(region));
  console.log(`wrote tiles/region.geojson: ${found.size} countries/territories, ${polygons.length} polygons, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
  if (missing.length) console.log(`not in Natural Earth 50m (covered by neighbours' tiles): ${missing.join(", ")}`);
})().catch((e) => { console.error(e); process.exit(1); });
