// Run with:  node tests/lost-groups.test.js
// The search-group list: the real file is valid, and the checks catch mistakes.
"use strict";
const assert = require("assert");
const { validate, build } = require("../tools/lost-groups.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

const group = (extra) => Object.assign({
  id: "vermiste-dieren-utrecht", name: "Vermiste dieren Utrecht", url: "https://www.facebook.com/groups/example",
  country: "NL", region: "Utrecht", lat: 52.09, lon: 5.12, radiusKm: 40, added: "2026-11-15", checked: "2026-11-15"
}, extra);

console.log("lost-groups");

test("lost/groups.json itself is valid", () => {
  assert.deepStrictEqual(validate(require("../lost/groups.json")), []);
});

test("a regional and a national group pass", () => {
  const national = group({ id: "national", url: "https://example.org/", region: undefined, lat: undefined, lon: undefined, radiusKm: undefined });
  assert.deepStrictEqual(validate({ groups: [group(), national] }), []);
});

test("http links, unknown countries and lower-case codes are refused", () => {
  assert.ok(validate({ groups: [group({ url: "http://example.org/" })] }).some((e) => e.includes("https")));
  assert.ok(validate({ groups: [group({ country: "US" })] }).some((e) => e.includes("country")));
  assert.ok(validate({ groups: [group({ country: "nl" })] }).some((e) => e.includes("country")));
});

test("duplicate ids and urls are refused", () => {
  const errs = validate({ groups: [group(), group()] });
  assert.ok(errs.some((e) => e.includes("duplicate id")));
  assert.ok(errs.some((e) => e.includes("duplicate url")));
});

test("an area needs lat, lon and radiusKm together", () => {
  assert.ok(validate({ groups: [group({ radiusKm: undefined })] }).some((e) => e.includes("go together")));
});

test("unknown fields and bad dates are refused", () => {
  assert.ok(validate({ groups: [group({ phone: "0612345678" })] }).some((e) => e.includes("unknown field")));
  assert.ok(validate({ groups: [group({ checked: "15-11-2026" })] }).some((e) => e.includes("checked")));
});

test("build keeps known fields only and sorts by country, region, name", () => {
  const out = build({ groups: [group({ id: "b", country: "NL", region: "Zeeland", url: "https://b.example/" }), group({ id: "a", country: "BE", url: "https://a.example/" })] });
  assert.strictEqual(out.version, 1);
  assert.deepStrictEqual(out.groups.map((g) => g.id), ["a", "b"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
