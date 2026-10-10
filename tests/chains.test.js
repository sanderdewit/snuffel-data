// Run with:  node tests/chains.test.js
"use strict";
const assert = require("assert");
const { detect, phoneKey, hostOf } = require("../lib/chains.js");

const ref = {
  phones: { "93605470": { g: "AniCura" }, "31234567": { g: "Evidensia" } },
  domains: { "aandeheikant.be": { g: "Evidensia" }, "scanned-clinic.nl": { g: "Evidensia", s: "website" } },
  overrides: { n1: { chain: "Evidensia" }, n2: { chain: null } }
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log("chain detection");

test("phone keys agree across national and international formats", () => {
  assert.strictEqual(phoneKey("079-3605470"), phoneKey("+31 79 360 5470"));
  assert.strictEqual(phoneKey("0031793605470"), phoneKey("079 360 54 70"));
  assert.strictEqual(phoneKey("03 123 45 67"), phoneKey("+32 3 123 45 67"));   // BE 8-digit landline
  assert.strictEqual(phoneKey("112"), null);
});

test("hosts are normalised", () => {
  assert.strictEqual(hostOf("https://www.AandeHeikant.be/contact"), "aandeheikant.be");
  assert.strictEqual(hostOf("aandeheikant.be"), "aandeheikant.be");
  assert.strictEqual(hostOf("info@anicura.nl"), "anicura.nl");
});

test("official phone match beats everything but overrides", () => {
  assert.deepStrictEqual(detect({ name: "Medisch Centrum voor Dieren", phone: "+31 79 360 5470" }, ref), { group: "AniCura", via: "official" });
  assert.deepStrictEqual(detect({ name: "X", phone: "0123; 079-3605470" }, ref), { group: "AniCura", via: "official" });  // 2nd number
});

test("official domain and scanned domain keep their source", () => {
  assert.deepStrictEqual(detect({ website: "https://www.aandeheikant.be/" }, ref), { group: "Evidensia", via: "official" });
  assert.deepStrictEqual(detect({ website: "scanned-clinic.nl" }, ref), { group: "Evidensia", via: "website" });
});

test("website or e-mail on a group domain", () => {
  assert.deepStrictEqual(detect({ website: "https://www.anicura.nl/klinieken/x/" }, null), { group: "AniCura", via: "website" });
  assert.deepStrictEqual(detect({ email: "info@ivcevidensia.nl" }, null), { group: "Evidensia", via: "website" });
  assert.deepStrictEqual(detect({ website: "https://caressa.nl" }, null), { group: "Evidensia", via: "website" });
  assert.strictEqual(detect({ website: "https://notanicura-fan.nl" }, null), null);   // substring is not a match
});

test("name / brand / operator tags", () => {
  assert.deepStrictEqual(detect({ name: "AniCura Zoetermeer" }, null), { group: "AniCura", via: "osm" });
  assert.deepStrictEqual(detect({ name: "Dierenkliniek X", operator: "IVC Evidensia" }, null), { group: "Evidensia", via: "osm" });
  assert.deepStrictEqual(detect({ name: "Caressa Dierenziekenhuis" }, null), { group: "Evidensia", via: "osm" });
  assert.deepStrictEqual(detect({ name: "Pets Place", brand: "Pets Place", "brand:wikidata": "Q1" }, null), { group: "Pets Place", via: "osm" });
});

test("other European groups by name and domain", () => {
  assert.deepStrictEqual(detect({ name: "Vets4Pets Leeds" }, null), { group: "Pets at Home Vet Group", via: "osm" });
  assert.deepStrictEqual(detect({ name: "Clinique Vétérinaire Argos Rennes" }, null), { group: "Argos Vétérinaire", via: "osm" });
  assert.deepStrictEqual(detect({ name: "Ca' Zampa Milano" }, null), { group: "Ca' Zampa", via: "osm" });
  assert.deepStrictEqual(detect({ website: "https://www.medivetgroup.com/vet-practices/x/" }, null), { group: "Medivet", via: "website" });
  assert.deepStrictEqual(detect({ website: "https://www.vetpartnersdeutschland.de/" }, null), { group: "VetPartners", via: "website" });
  assert.deepStrictEqual(detect({ website: "https://vetgruppen.dk/aarhus/" }, null), { group: "Vetopia", via: "website" });
});

test("generic words that collide with group names stay independent", () => {
  assert.strictEqual(detect({ name: "Dierenkliniek Linnaeusstraat" }, null), null);
  assert.strictEqual(detect({ name: "Eläinlääkäri Kivet" }, null), null);
  assert.strictEqual(detect({ name: "Clinica Veterinaria Animalia" }, null), null);
  assert.strictEqual(detect({ name: "Argos Pet Shop" }, null), null);
  assert.strictEqual(detect({ website: "https://notunivet.fr" }, null), null);
});

test("manual overrides win, including 'verified independent'", () => {
  assert.deepStrictEqual(detect({ name: "AniCura Foo" }, ref, "n1"), { group: "Evidensia", via: "manual" });
  assert.deepStrictEqual(detect({ name: "AniCura Foo" }, ref, "n2"), { group: null, via: "manual" });
});

test("plain independents stay independent", () => {
  assert.strictEqual(detect({ name: "Dierenartsenpraktijk De Linde", phone: "020 555 1234", website: "delinde.nl" }, ref), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
