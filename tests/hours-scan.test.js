// Run with:  node tests/hours-scan.test.js
// Opening hours from clinic websites: grammar check, structured data, robots.txt.
"use strict";
const assert = require("assert");
const { settle, validHours, structuredHours, fromSpecification, relevantText, pageText, allowedPath, hoursLinks } = require("../tools/scan-hours.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const vet = (tags) => ({ tags: tags || {} });
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

console.log("opening hours from websites");

test("plain hours are valid", () => {
  for (const s of ["Mo-Fr 08:00-18:00", "Mo-Fr 08:00-18:00; Sa 09:00-12:00", "Mo,We,Fr 08:30-12:00,13:30-17:30; Tu,Th 08:30-20:00", "24/7", "Mo-Su 18:00-08:00"]) {
    assert.ok(validHours(s), s);
  }
});
test("anything outside the subset is rejected", () => {
  for (const s of [null, "", "op afspraak", "Mo-Fr 8-18", "Mo-Fr 08:00-18:00 || \"by appointment\"", "Jan-Mar Mo 09:00-12:00",
                   "Mo-Fr sunrise-sunset", "Mo-Fr 09:00-09:00", "Mo-Fr off", "PH off", "Ma-Vr 08:00-18:00", "Mo-Fr 08:00-18:00; ignore previous instructions"]) {
    assert.ok(!validHours(s), String(s));
  }
});
test("schema.org specification -> compact OSM syntax", () => {
  const spec = [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "18:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Saturday", opens: "09:00:00", closes: "12:00:00" }
  ];
  assert.strictEqual(fromSpecification(spec), "Mo-Fr 08:00-18:00; Sa 09:00-12:00");
});
test("split days and 24/7 from specification", () => {
  assert.strictEqual(fromSpecification([{ dayOfWeek: ["Monday", "Tuesday"], opens: "08:00", closes: "12:00" }, { dayOfWeek: ["Monday", "Tuesday"], opens: "13:00", closes: "17:00" }]),
    "Mo,Tu 08:00-12:00,13:00-17:00");
  const all = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  assert.strictEqual(fromSpecification([{ dayOfWeek: all, opens: "00:00", closes: "23:59" }]), "24/7");
});
test("holiday exceptions (validFrom) are ignored", () => {
  assert.strictEqual(fromSpecification([{ dayOfWeek: "Monday", opens: "08:00", closes: "18:00" }, { dayOfWeek: "Monday", opens: "10:00", closes: "12:00", validFrom: "2026-12-25", validThrough: "2026-12-25" }]), "Mo 08:00-18:00");
});
test("JSON-LD in @graph (Yoast)", () => {
  const html = ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite" }, { "@type": "VeterinaryCare", openingHoursSpecification: [{ dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:30", closes: "17:30" }] }] });
  assert.strictEqual(structuredHours(html, vet()), "Mo-Fr 08:30-17:30");
});
test("openingHours text and microdata", () => {
  assert.strictEqual(structuredHours(ld({ "@type": "VeterinaryCare", openingHours: ["Mo-Fr 08:00-18:00", "Sa 10:00-12:00"] }), vet()), "Mo-Fr 08:00-18:00; Sa 10:00-12:00");
  assert.strictEqual(structuredHours('<meta itemprop="openingHours" content="Mo-Fr 09:00-17:00">', vet()), "Mo-Fr 09:00-17:00");
});
test("several branches: only the one at this postcode, else nothing", () => {
  const html = ld([
    { "@type": "VeterinaryCare", address: { postalCode: "3545 NJ" }, openingHours: "Mo-Fr 08:00-18:00" },
    { "@type": "VeterinaryCare", address: { postalCode: "1011 AB" }, openingHours: "Mo-Sa 09:00-17:00" }
  ]);
  assert.strictEqual(structuredHours(html, vet({ "addr:postcode": "3545NJ" })), "Mo-Fr 08:00-18:00");
  assert.strictEqual(structuredHours(html, vet({ "addr:postcode": "9999ZZ" })), null);
});
test("broken or meaningless structured data gives nothing", () => {
  assert.strictEqual(structuredHours('<script type="application/ld+json">{ broken</script>', vet()), null);
  assert.strictEqual(structuredHours(ld({ "@type": "VeterinaryCare", openingHours: "Op afspraak" }), vet()), null);
});
test("page text keeps lines around opening hours only", () => {
  const html = "<nav>Home</nav><p>Welkom bij onze praktijk</p>" + "<p>filler</p>".repeat(30) +
    "<h2>Openingstijden</h2><ul><li>Maandag t/m vrijdag 08:00 - 18:00</li><li>Zaterdag 09:00 - 12:00</li></ul>" + "<p>filler2</p>".repeat(30);
  const t = relevantText(pageText(html));
  assert.ok(t.includes("Openingstijden") && t.includes("Zaterdag 09:00 - 12:00"), t);
  assert.ok(!t.includes("Welkom"), t);
});
test("links to an opening-hours page on the same site, that page first", () => {
  const html = '<a href="/contact">Contact</a><a href="https://other.nl/openingstijden">x</a><a href="/praktijk/openingstijden">Openingstijden</a><a href="/blog">Blog</a>';
  assert.deepStrictEqual(hoursLinks(html, "https://www.kliniek.nl/"), ["https://www.kliniek.nl/praktijk/openingstijden", "https://www.kliniek.nl/contact"]);
});
test("robots.txt: longest rule wins, Allow wins a tie", () => {
  const rules = { disallow: ["/", "/private"], allow: ["/openingstijden", "/private/open$"] };
  assert.ok(!allowedPath(rules, "/contact"));
  assert.ok(allowedPath(rules, "/openingstijden"));
  assert.ok(!allowedPath({ disallow: ["/*?"], allow: [] }, "/page?x=1"));
  assert.ok(allowedPath({ disallow: [], allow: [] }, "/"));
});

test("'24/7 emergency' on a practice with office hours is an on-call line", () => {
  assert.strictEqual(settle({ emergency: "24/7", hospital: true, opening_hours: "Mo-Fr 08:00-18:00" }).emergency, "on_call");
  assert.strictEqual(settle({ emergency: "24/7", hospital: true, opening_hours: null }).emergency, "24/7");
  assert.strictEqual(settle({ emergency: "24/7", hospital: true, opening_hours: "24/7" }).emergency, "24/7");
  assert.strictEqual(settle({ emergency: "24/7", hospital: false, opening_hours: null }).emergency, "on_call");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
