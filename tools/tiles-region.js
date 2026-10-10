#!/usr/bin/env node
/* ============================================================================
 * Snuffel — region outline for the basemap extract
 *
 * Writes tiles/region.geojson: the outlines of NL, BE, FR, DE, PL and CZ (from
 * Natural Earth, public domain), used by `pmtiles extract --region` to cut just
 * our six countries out of the Protomaps planet build. Real outlines instead of
 * bounding boxes keep Spain, Switzerland, northern Italy and a lot of sea out of
 * the file. France's overseas territories are dropped by keeping only polygons
 * inside Europe.
 *
 * Usage: node tools/tiles-region.js   (re-run only if the country list changes)
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson";
const COUNTRIES = ["NLD", "BEL", "FRA", "DEU", "POL", "CZE"];
const EUROPE = { s: 40, w: -10, n: 60, e: 30 };
const OUT = path.join(__dirname, "..", "tiles", "region.geojson");

function inEurope(polygon) {
  return polygon[0].every(([lon, lat]) => lat >= EUROPE.s && lat <= EUROPE.n && lon >= EUROPE.w && lon <= EUROPE.e);
}

(async () => {
  const r = await fetch(SOURCE);
  if (!r.ok) throw new Error("Natural Earth download failed: " + r.status);
  const world = await r.json();
  const polygons = [];
  for (const f of world.features) {
    if (!COUNTRIES.includes(f.properties.ADM0_A3)) continue;
    const g = f.geometry;
    const parts = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const p of parts) if (inEurope(p)) polygons.push(p);
  }
  const found = new Set(world.features.filter((f) => COUNTRIES.includes(f.properties.ADM0_A3)).map((f) => f.properties.ADM0_A3));
  const missing = COUNTRIES.filter((c) => !found.has(c));
  if (missing.length) throw new Error("not found in Natural Earth: " + missing.join(", "));
  const region = { type: "FeatureCollection", features: [{ type: "Feature", properties: { countries: COUNTRIES }, geometry: { type: "MultiPolygon", coordinates: polygons } }] };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(region));
  console.log(`wrote tiles/region.geojson: ${COUNTRIES.join(", ")} -> ${polygons.length} polygons, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
})().catch((e) => { console.error(e); process.exit(1); });
