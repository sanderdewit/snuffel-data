// Run with:  node tests/breeds.test.js
// The breed list (breeds/breeds.json, built by tools/build-breeds.js): valid, stable
// ids, a name in every app language, and the parsers of the sources.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const b = require("../tools/build-breeds.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "breeds", "breeds.json"), "utf8"));
const ov = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "breeds", "overrides.json"), "utf8"));
const LANGS = require("../i18n/languages.json").languages.map((l) => l.code);
const byId = new Map(data.breeds.map((e) => [e.id, e]));

console.log("breeds");

test("breeds.json and overrides.json pass the generator's own checks", () => {
  assert.deepStrictEqual(b.validate(data), []);
  assert.deepStrictEqual(b.validateOverrides(ov), []);
  assert.deepStrictEqual(b.danglingOverrides(ov, data), []);
});

test("ids are unique and well formed", () => {
  const ids = data.breeds.map((e) => e.id);
  assert.strictEqual(new Set(ids).size, ids.length, "duplicate ids");
  for (const id of ids) assert.match(id, /^(fci-\d+(-[a-z0-9]+)*|x-[a-z0-9-]+|nf-[a-z0-9-]+|mixed|other)$/, id);
});

test("every breed has an English name", () => {
  for (const e of data.breeds) assert.ok(typeof e.names.en === "string" && e.names.en.trim(), e.id);
});

test("all 29 languages are present for every breed", () => {
  assert.strictEqual(LANGS.length, 29);
  assert.deepStrictEqual(data.languages, LANGS);
  for (const e of data.breeds) {
    assert.deepStrictEqual(Object.keys(e.names).sort(), [...LANGS].sort(), e.id);
    for (const l of LANGS) assert.ok(e.names[l].trim(), `${e.id} ${l}`);
  }
});

test("the full FCI list is there, with mixed, other, crosses and varieties", () => {
  const fci = data.breeds.filter((e) => e.kind === "breed" && e.fci);
  assert.ok(fci.length >= 350, `only ${fci.length} FCI breeds`);
  for (const id of ["fci-122", "fci-166", "fci-101", "fci-15-malinois", "fci-172-toy", "x-labradoodle", "x-cockapoo", "nf-american-bully", "mixed", "other"]) assert.ok(byId.has(id), id);
  for (const e of data.breeds.filter((x) => x.kind === "variety")) assert.strictEqual(byId.get(e.of).kind, "breed", e.id);
});

test("Serbian names are in Latin script, as in the app", () => {
  for (const e of data.breeds) assert.ok(!/[Ѐ-ӿ]/.test(e.names.sr), `${e.id}: ${e.names.sr}`);
});

test("popular order: unique ranks from 1, mixed first", () => {
  const ranked = data.breeds.filter((e) => e.rank).sort((x, y) => x.rank - y.rank);
  assert.deepStrictEqual(ranked.map((e) => e.rank), ranked.map((_, i) => i + 1));
  assert.strictEqual(ranked[0].id, "mixed");
});

// what the app searches: the names in every language and the aliases
const terms = (id) => [...Object.values(byId.get(id).names), ...byId.get(id).aliases].map(b.norm);

test("Dutch names follow the Raad van Beheer, old names stay searchable", () => {
  assert.strictEqual(byId.get("fci-166").names.nl, "Duitse Herdershond");
  assert.ok(byId.get("fci-166").aliases.includes("Duitse herder"));
  assert.ok(terms("fci-148").includes("teckel"));
});

test("common misspellings from the breed cards are search terms", () => {
  assert.ok(terms("fci-122").includes("labrador retriver"));
  assert.ok(terms("fci-345").includes("jack russel"));
  assert.ok(terms("x-cockapoo").includes("cockerpoo"));
});

test("norm: lowercase, no accents or punctuation", () => {
  assert.strictEqual(b.norm("Mäyräkoira"), "mayrakoira");
  assert.strictEqual(b.norm("  Shih-Tzu! "), "shih tzu");
  assert.strictEqual(b.norm("Großspitz"), "grossspitz");
  assert.strictEqual(b.norm("Søndag Ćevapi Łódź"), "sondag cevapi lodz");
});

test("srLatin: Serbian Cyrillic to Latin, other Cyrillic refused", () => {
  assert.strictEqual(b.srLatin("Немачки овчар"), "Nemački ovčar");
  assert.strictEqual(b.srLatin("Шарпланинац"), "Šarplaninac");
  assert.strictEqual(b.srLatin("Љубимац"), "Ljubimac");
  assert.strictEqual(b.srLatin("Немецкая овчарка"), null);   // Russian
});

test("FCI names: title case, number, English name", () => {
  assert.deepStrictEqual(b.parseFciName("CHIEN DE BERGER BELGE (15) (BELGIAN SHEPHERD DOG)"),
    { fci: 15, original: "Chien de Berger Belge", english: "Belgian Shepherd Dog" });
  assert.deepStrictEqual(b.parseFciName("WELSH CORGI (CARDIGAN) (38)"),
    { fci: 38, original: "Welsh Corgi (Cardigan)", english: "Welsh Corgi (Cardigan)" });
  assert.strictEqual(b.titleCase("GOS D'ATURA CATALÀ"), "Gos d'Atura Català");
  assert.strictEqual(b.titleCase("CIRNECO DELL'ETNA"), "Cirneco dell'Etna");
});

test("FCI and Raad van Beheer page parsers", () => {
  const group = '<span id="x_SectionLabel_0"><b>Section 1 : </b>Sheepdogs</span>' +
    '<a id="a" class="nom" href="/en/nomenclature/AUSTRALIAN-KELPIE-293.html">AUSTRALIAN KELPIE (293)</a>' +
    '<span id="x_SectionLabel_1"><b>Section 2 : </b>Cattledogs</span>' +
    '<a id="b" class="nom" href="/x">BOUVIER DES ARDENNES (171)</a>';
  assert.deepStrictEqual(b.parseFciGroup(group, 1).map((x) => [x.fci, x.section, x.group, x.status]), [[293, 1, 1, "definitive"], [171, 2, 1, "definitive"]]);
  const prov = '<h2 class="nom"> Breeds recognised on a provisonal basis </h2><p>text (1)</p>' +
    '<a id="c" class="nom" name="378" href="/x">MACEDONIAN SHEPHERD DOG KARAMAN  (378)</a> <div class="standard"> <a href="../../Nomenclature/Standards/378g02-en.pdf">';
  assert.deepStrictEqual(b.parseFciProvisional(prov).map((x) => [x.fci, x.group, x.english]), [[378, 2, "Macedonian Shepherd Dog Karaman"]]);
  const rvb = '<a class="large" href="/hondenrassen/alle-rassen/fci-groep-2/aidi/">A&#239;di</a>';
  assert.deepStrictEqual(b.parseRvb(rvb), [{ group: 2, name: "Aïdi" }]);
});

test("validate catches the usual mistakes", () => {
  const good = JSON.parse(JSON.stringify(data));
  const one = good.breeds.find((e) => e.id === "fci-122");
  const bad = (f) => { const d = JSON.parse(JSON.stringify(good)); f(d); return b.validate(d); };
  assert.ok(bad((d) => d.breeds.push(Object.assign({}, one))).some((e) => e.includes("duplicate id")));
  assert.ok(bad((d) => { delete d.breeds.find((e) => e.id === "fci-122").names.mk; }).some((e) => e.includes("names.mk")));
  assert.ok(bad((d) => { d.breeds = d.breeds.filter((e) => e.id !== "other"); }).some((e) => e.includes("other")));
  assert.ok(bad((d) => { d.breeds.find((e) => e.id === "fci-122").id = "Labrador"; }).some((e) => e.includes("bad id")));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
