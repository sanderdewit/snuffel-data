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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
