// Run with:  node tests/places.test.js
// Builds a tiny dataset from a synthetic osmium geojsonseq export and checks the output.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snuffel-places-"));
const env = Object.assign({}, process.env, { SNUFFEL_DIST: tmp });
const tool = path.join(__dirname, "..", "tools", "build-places.js");
const RS = "\u001e";   // osmium's geojsonseq record separator
const feat = (type, id, geometry, tags) =>
  RS + JSON.stringify({ type: "Feature", geometry, properties: Object.assign({ "@type": type, "@id": id }, tags) });

const nl = [
  feat("node", 1, { type: "Point", coordinates: [4.89, 52.37] }, { amenity: "veterinary", name: "Dierenkliniek A", phone: "+31 20 1", source: "BAG" }),
  feat("way", 2, { type: "Polygon", coordinates: [[[4.80, 52.30], [4.82, 52.30], [4.82, 52.32], [4.80, 52.30]]] }, { leisure: "park", name: "Hondenweide Noord" }),
  feat("way", 3, { type: "Polygon", coordinates: [[[4.70, 52.30], [4.72, 52.30], [4.72, 52.32], [4.70, 52.30]]] }, { leisure: "park", name: "Vondelpark" }),
  feat("node", 4, { type: "Point", coordinates: [4.90, 52.38] }, { amenity: "animal_training", animal_training: "horse", name: "Manege" }),
  feat("node", 5, { type: "Point", coordinates: [4.91, 52.38] }, { amenity: "animal_training", animal_training: "dog", name: "Hondenschool" }),
  feat("way", 6, { type: "LineString", coordinates: [[5.00, 52.10], [5.02, 52.12]] }, { highway: "path", dog: "unleashed" })
].join("\n");
const be = [
  feat("node", 1, { type: "Point", coordinates: [4.89, 52.37] }, { amenity: "veterinary", name: "Dierenkliniek A" }),   // border duplicate
  feat("node", 7, { type: "Point", coordinates: [4.40, 51.22] }, { shop: "pet", name: "Dierenwinkel B" })
].join("\n");
fs.writeFileSync(path.join(tmp, "nl.geojsonseq"), nl);
fs.writeFileSync(path.join(tmp, "be.geojsonseq"), be);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log("places dataset build");
execFileSync("node", [tool, "add", "nl", path.join(tmp, "nl.geojsonseq")], { env });
execFileSync("node", [tool, "add", "be", path.join(tmp, "be.geojsonseq")], { env });
execFileSync("node", [tool, "assemble"], { env });

const manifest = JSON.parse(fs.readFileSync(path.join(tmp, "places", "manifest.json"), "utf8"));
const all = [];
for (const c of manifest.cells) all.push(...JSON.parse(fs.readFileSync(path.join(tmp, manifest.path, c + ".json"), "utf8")));
const byId = Object.fromEntries(all.map((e) => [e.id, e]));

test("keeps dog places, drops the rest", () => {
  assert.deepStrictEqual(Object.keys(byId).sort(), ["n1", "n5", "n7", "w2", "w6"]);
});
test("parks only count when named as a dog area", () => {
  assert.ok(byId.w2 && !byId.w3);
});
test("horse training is not a dog trainer", () => {
  assert.ok(byId.n5 && !byId.n4);
});
test("border duplicates are kept once", () => {
  assert.strictEqual(all.filter((e) => e.id === "n1").length, 1);
});
test("only tags the site uses are kept", () => {
  assert.deepStrictEqual(byId.n1.tags, { amenity: "veterinary", name: "Dierenkliniek A", phone: "+31 20 1" });
});
test("areas and lines get a centre point", () => {
  assert.ok(Math.abs(byId.w2.lat - 52.31) < 1e-9 && Math.abs(byId.w2.lon - 4.81) < 1e-9);
  assert.ok(Math.abs(byId.w6.lat - 52.11) < 1e-9);
});
test("cells are 0.25 degree tiles keyed by floor(lat/0.25)_floor(lon/0.25)", () => {
  assert.ok(manifest.cells.includes(Math.floor(52.37 / 0.25) + "_" + Math.floor(4.89 / 0.25)));
  assert.strictEqual(manifest.cell, 0.25);
  assert.match(manifest.path, /^places\/\d{4}-\d{2}-\d{2}\/$/);
});
test("manifest carries the ODbL attribution and per-country counts", () => {
  assert.match(manifest.licence, /ODbL/);
  assert.deepStrictEqual(manifest.countries, { be: 1, nl: 4 });
});
test("vet list for the website scanner is written", () => {
  const vets = JSON.parse(fs.readFileSync(path.join(tmp, "cache", "osm-vets-nl.json"), "utf8"));
  assert.strictEqual(vets.length, 1);
  assert.strictEqual(vets[0].tags.source, "BAG");   // full tags, the scanner needs website/phone
});

// Second build: hand-checked extra places and opening hours from clinic websites.
fs.writeFileSync(path.join(tmp, "extra.json"), JSON.stringify({ places: [
  { id: "x-nl-er", cc: "nl", lat: 52.01, lon: 5.10, source: "https://example.nl/", checked: "2026-10-12", tags: { amenity: "veterinary", name: "Spoedkliniek", opening_hours: "24/7", "snuffel:emergency": "24/7" } },
  { id: "x-de-er", cc: "de", lat: 52.5, lon: 13.4, source: "https://example.de/", checked: "2026-10-12", tags: { amenity: "veterinary", name: "Notfallklinik" } },
  { id: "x-nl-moved", cc: "nl", lat: 52.2, lon: 4.9, replaces: ["n5"], source: "https://example.nl/m", checked: "2026-10-12", tags: { amenity: "animal_training", name: "Hondenschool (nieuw adres)" } },
  { patch: "n1", source: "https://example.nl/a", checked: "2026-10-12", tags: { opening_hours: "24/7", "snuffel:emergency": "24/7", phone: "+31 99" } }
] }));
fs.writeFileSync(path.join(tmp, "hours.json"), JSON.stringify({ places: {
  n1: { opening_hours: "Mo-Fr 08:00-18:00", emergency: "on_call", emergency_phone: null, checked: "2026-10-11" },
  w2: { opening_hours: "Mo-Fr 09:00-17:00", emergency: null, emergency_phone: null, checked: "2026-10-11" }
} }));
execFileSync("node", [tool, "assemble"], { env: Object.assign({}, env, { SNUFFEL_EXTRA: path.join(tmp, "extra.json") }) });
const m2 = JSON.parse(fs.readFileSync(path.join(tmp, "places", "manifest.json"), "utf8"));
const all2 = [];
for (const c of m2.cells) all2.push(...JSON.parse(fs.readFileSync(path.join(tmp, m2.path, c + ".json"), "utf8")));
const byId2 = Object.fromEntries(all2.map((e) => [e.id, e]));
test("extra places are added for countries in the build only, with their source", () => {
  assert.ok(byId2["x-nl-er"] && !byId2["x-de-er"]);
  assert.strictEqual(byId2["x-nl-er"].cc, "nl");
  assert.strictEqual(byId2["x-nl-er"].tags["snuffel:source"], "https://example.nl/");
});
test("an outdated OSM location is replaced", () => {
  assert.ok(byId2["x-nl-moved"] && !byId2.n5);
});
test("a patch adds hand-checked facts, wins over website hours, never overwrites OSM", () => {
  assert.strictEqual(byId2.n1.tags.opening_hours, undefined);
  assert.strictEqual(byId2.n1.tags["snuffel:opening_hours"], "24/7");
  assert.strictEqual(byId2.n1.tags["snuffel:emergency"], "24/7");
  assert.strictEqual(byId2.n1.tags.phone, "+31 20 1");
  assert.strictEqual(byId2.n1.tags["snuffel:source"], "https://example.nl/a");
});
test("website hours are added as separate fields", () => {
  assert.strictEqual(byId2.w2.tags["snuffel:opening_hours"], "Mo-Fr 09:00-17:00");
  assert.strictEqual(byId2.w2.tags.opening_hours, undefined);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
