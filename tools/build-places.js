#!/usr/bin/env node
/* ============================================================================
 * Snuffel — prebuilt places dataset
 *
 * Turns OpenStreetMap country extracts into the small static files the site
 * reads instead of querying Overpass live:
 *
 *   dist/places/manifest.json             which cells exist, where they live
 *   dist/places/<version>/<lat>_<lon>.json one file per 0.25 x 0.25 degree cell
 *
 * Two steps, so the workflow can process one country at a time (disk space):
 *
 *   node tools/build-places.js add <cc> <extract.geojsonseq>
 *       <extract> comes from:  osmium tags-filter <cc>.osm.pbf <FILTER> -o f.pbf
 *                              osmium export f.pbf -f geojsonseq -a type,id -o <extract>
 *       Classifies every feature with lib/classify.js (same rules as the site),
 *       keeps the tags the site uses, and stages dist/stage/<cc>.json. It also
 *       writes tools/.cache/osm-vets-<cc>.json for tools/scan-websites.js.
 *
 *   node tools/build-places.js assemble
 *       Merges all staged countries (dropping border duplicates) into cells and
 *       writes the manifest. Cells go into a dated folder so browsers can cache
 *       them for long; only the manifest is fetched fresh.
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { classify, KEEP_TAGS } = require("../lib/classify.js");

// SNUFFEL_DIST lets tests build into a temporary folder.
const DIST = process.env.SNUFFEL_DIST || path.join(__dirname, "..", "dist");
const STAGE = path.join(DIST, "stage");
const PLACES = path.join(DIST, "places");
const VET_CACHE = process.env.SNUFFEL_DIST ? path.join(DIST, "cache") : path.join(__dirname, ".cache");
const CELL = 0.25;

// The tag filter the workflow passes to `osmium tags-filter`. Parks and
// recreation grounds are included so name-matched dog fields ("hondenweide",
// "Hundewiese") can be found; classify() drops every park without such a name.
const OSMIUM_FILTER = [
  "nwr/amenity=veterinary,animal_boarding,animal_shelter,animal_training",
  "nwr/shop=pet,pet_grooming,pet_care",
  "nwr/craft=pet_grooming",
  "nwr/leisure=dog_park,park,common,recreation_ground",
  "nwr/dog=unleashed"
];

// Centre of a GeoJSON geometry's bounding box: good enough to place a pin.
function centre(geom) {
  let s = 90, w = 180, n = -90, e = -180;
  (function walk(c) {
    if (typeof c[0] === "number") {
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
    } else c.forEach(walk);
  })(geom.type === "GeometryCollection" ? geom.geometries.map((g) => g.coordinates) : geom.coordinates);
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}

const round = (x) => Math.round(x * 1e6) / 1e6;

async function add(cc, file) {
  const places = [], vets = [], byCat = {};
  let lines = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.replace(/^\u001e/, "").trim();   // geojsonseq record separator
    if (!line) continue;
    lines++;
    const f = JSON.parse(line);
    const props = f.properties || {};
    const tags = {};
    for (const k of Object.keys(props)) if (k[0] !== "@") tags[k] = props[k];
    const cat = classify(tags);
    if (!cat || !f.geometry) continue;

    const kept = {};
    for (const k of Object.keys(tags)) if (KEEP_TAGS.test(k)) kept[k] = tags[k];
    const c = centre(f.geometry);
    const type = props["@type"] || "node";
    const el = { id: type.charAt(0) + props["@id"], lat: round(c.lat), lon: round(c.lon), tags: kept };
    places.push(el);
    byCat[cat] = (byCat[cat] || 0) + 1;
    if (tags.amenity === "veterinary") vets.push({ type, id: props["@id"], lat: el.lat, lon: el.lon, tags });
  }
  fs.mkdirSync(STAGE, { recursive: true });
  fs.writeFileSync(path.join(STAGE, cc + ".json"), JSON.stringify(places));
  fs.mkdirSync(VET_CACHE, { recursive: true });
  fs.writeFileSync(path.join(VET_CACHE, `osm-vets-${cc}.json`), JSON.stringify(vets));
  console.log(`${cc}: ${lines} features read, ${places.length} places kept ${JSON.stringify(byCat)}`);
}

function assemble() {
  const staged = fs.existsSync(STAGE) ? fs.readdirSync(STAGE).filter((f) => /^[a-z]{2}\.json$/.test(f)) : [];
  if (!staged.length) throw new Error("nothing staged - run `add` first");
  const version = new Date().toISOString().slice(0, 10);
  // A place near a border appears in both countries' extracts; keep the copy
  // with the most tags (extracts can lag each other by a day).
  const best = new Map();
  for (const f of staged) {
    const cc = f.slice(0, 2);
    for (const el of JSON.parse(fs.readFileSync(path.join(STAGE, f), "utf8"))) {
      const prev = best.get(el.id);
      if (!prev || Object.keys(el.tags).length > Object.keys(prev.el.tags).length) best.set(el.id, { el, cc });
    }
  }
  // Emergency clinics missing from OSM, checked by hand (tools/extra-places.json).
  // Only for countries in this build, and never twice.
  // (tests build into SNUFFEL_DIST and only use a file they name in SNUFFEL_EXTRA)
  const extraFile = process.env.SNUFFEL_EXTRA || (process.env.SNUFFEL_DIST ? "" : path.join(__dirname, "extra-places.json"));
  const stagedCc = new Set(staged.map((f) => f.slice(0, 2)));
  let extras = 0;
  //   new place:  { id, cc, lat, lon, tags, source, checked, replaces?: [osm id] }
  //               "replaces" drops an OSM entry with an outdated location
  //   patch:      { patch: <osm id>, tags, source, checked } adds "snuffel:" facts
  //               (opening_hours becomes snuffel:opening_hours; OSM's own wins)
  if (fs.existsSync(extraFile)) {
    for (const x of JSON.parse(fs.readFileSync(extraFile, "utf8")).places || []) {
      const meta = { "snuffel:source": x.source, "snuffel:checked": x.checked };
      if (x.patch) {
        const hit = best.get(x.patch);
        if (!hit) continue;
        const add = {};
        for (const [k, v] of Object.entries(x.tags || {})) {
          if (k === "opening_hours") { if (!hit.el.tags.opening_hours) add["snuffel:opening_hours"] = v; }
          else if (k.startsWith("snuffel:") || !hit.el.tags[k]) add[k] = v;
        }
        hit.el.tags = { ...hit.el.tags, ...add, ...meta };
        extras++;
        continue;
      }
      if (!stagedCc.has(x.cc) || best.has(x.id)) continue;
      for (const old of x.replaces || []) best.delete(old);
      best.set(x.id, { el: { id: x.id, lat: x.lat, lon: x.lon, tags: { ...x.tags, ...meta } }, cc: x.cc });
      extras++;
    }
  }

  // Opening hours / emergency info from the clinics' own websites (tools/scan-hours.js),
  // as separate "snuffel:" fields: OSM's own opening_hours always wins.
  const hoursFile = path.join(DIST, "hours.json");
  const web = fs.existsSync(hoursFile) ? JSON.parse(fs.readFileSync(hoursFile, "utf8")).places || {} : {};
  let withWebHours = 0;
  const seen = new Set(best.keys()), cells = new Map(), countries = {};
  for (const { el, cc } of best.values()) {
    const w = el.tags["snuffel:source"] ? null : web[el.id];   // hand-checked entries win
    if (w) {
      const extra = {};
      if (w.opening_hours && !el.tags.opening_hours) { extra["snuffel:opening_hours"] = w.opening_hours; withWebHours++; }
      if (w.emergency) extra["snuffel:emergency"] = w.emergency;
      if (w.emergency && w.emergency_phone) extra["snuffel:emergency_phone"] = w.emergency_phone;
      if (Object.keys(extra).length) el.tags = { ...el.tags, ...extra, "snuffel:checked": w.checked };
    }
    const key = Math.floor(el.lat / CELL) + "_" + Math.floor(el.lon / CELL);
    if (!cells.has(key)) cells.set(key, []);
    // Country, for the opening-hours time zone (lib/hours.js tzFor). The place's
    // own addr:country beats the extract it came from: extracts overlap at borders.
    const own = String(el.tags["addr:country"] || "").toLowerCase();
    cells.get(key).push({ ...el, cc: /^[a-z]{2}$/.test(own) ? own : cc });
    countries[cc] = (countries[cc] || 0) + 1;
  }
  const dir = path.join(PLACES, version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (const [key, items] of cells) {
    const body = JSON.stringify(items);
    bytes += Buffer.byteLength(body);
    fs.writeFileSync(path.join(dir, key + ".json"), body);
  }
  const manifest = {
    version, generated: new Date().toISOString(), cell: CELL, path: `places/${version}/`,
    countries, places: seen.size, cells: [...cells.keys()].sort(),
    licence: "Contains OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)"
  };
  fs.writeFileSync(path.join(PLACES, "manifest.json"), JSON.stringify(manifest));
  console.log(`assembled ${seen.size} places in ${cells.size} cells (${(bytes / 1e6).toFixed(1)} MB) -> dist/places/${version}/`);
  console.log(JSON.stringify(countries));
  console.log(`opening hours from clinic websites: ${withWebHours} places; hand-checked extra places: ${extras}`);
}

module.exports = { OSMIUM_FILTER, centre };
if (require.main === module) {
  const [cmd, cc, file] = process.argv.slice(2);
  if (cmd === "filter") console.log(OSMIUM_FILTER.join(" "));       // for the workflow
  else if (cmd === "add" && /^[a-z]{2}$/.test(cc || "") && file) add(cc, file).catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === "assemble") assemble();
  else { console.error("usage: build-places.js filter | add <cc> <file.geojsonseq> | assemble"); process.exit(2); }
}
