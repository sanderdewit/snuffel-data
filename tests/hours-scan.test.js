// Run with:  node tests/hours-scan.test.js
// Opening hours from clinic websites: grammar check, structured data, robots.txt.
"use strict";
const assert = require("assert");
const { settle, validHours, oneRulePerDay, structuredHours, fromSpecification, relevantText, pageText, allowedPath, hoursLinks, aboutHours, roundTheClock } = require("../tools/scan-hours.js");

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
test("robots.txt: wildcards and the $ anchor", () => {
  const q = { disallow: ["/*?"], allow: [] };
  assert.ok(!allowedPath(q, "/page?x=1"));
  assert.ok(!allowedPath(q, "/?"));
  assert.ok(allowedPath(q, "/page"));
  const open = { disallow: ["/private"], allow: ["/private/open$"] };
  assert.ok(allowedPath(open, "/private/open"));
  assert.ok(!allowedPath(open, "/private/open/more"));
  assert.ok(!allowedPath(open, "/private/x"));
  const root = { disallow: ["/"], allow: [] };
  assert.ok(!allowedPath(root, "/"));
  assert.ok(!allowedPath(root, "/anything"));
  assert.ok(!allowedPath({ disallow: ["/*.pdf$"], allow: [] }, "/files/a.pdf"));
  assert.ok(allowedPath({ disallow: ["/*.pdf$"], allow: [] }, "/files/a.pdf.html"));
  assert.ok(!allowedPath({ disallow: ["/a**b"], allow: [] }, "/a-x-b"));        // runs of * collapse
  assert.ok(allowedPath({ disallow: ["/abc$"], allow: [] }, "/ab"));
  assert.ok(!allowedPath({ disallow: ["/a*c$"], allow: [] }, "/abcbc"));
  assert.ok(allowedPath({ disallow: ["/a*bc*bc$"], allow: [] }, "/abc"));     // pieces must not overlap
});
test("robots.txt: hostile rules can't hang the scan", () => {
  const evil = "/*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a$";
  const start = Date.now();
  for (let i = 0; i < 100; i++) allowedPath({ disallow: [evil], allow: [] }, "/" + "a".repeat(30));
  allowedPath({ disallow: ["/" + "*a".repeat(5000) + "$"], allow: [] }, "/" + "a".repeat(10000));
  assert.ok(Date.now() - start < 100, `took ${Date.now() - start} ms`);
  assert.ok(!allowedPath({ disallow: [evil], allow: [] }, "/" + "a".repeat(30)));
  assert.ok(allowedPath({ disallow: [evil], allow: [] }, "/" + "a".repeat(30) + "b"));
  assert.ok(allowedPath({ disallow: ["/" + "x".repeat(600)], allow: [] }, "/" + "x".repeat(700)));   // over-long rule ignored
});

test("'24/7 emergency' on a practice with office hours is an on-call line", () => {
  assert.strictEqual(settle({ emergency: "24/7", hospital: true, opening_hours: "Mo-Fr 08:00-18:00" }).emergency, "on_call");
  assert.strictEqual(settle({ emergency: "24/7", hospital: true, opening_hours: null }).emergency, "24/7");
  assert.strictEqual(settle({ emergency: "24/7", hospital: true, opening_hours: "24/7" }).emergency, "24/7");
  assert.strictEqual(settle({ emergency: "24/7", hospital: false, opening_hours: null }).emergency, "on_call");
});

test("every day in one rule only (a later rule replaces an earlier one)", () => {
  for (const s of ["Mo-Fr 08:00-18:00; Sa 09:00-12:00", "24/7", "Mo-Th 08:00-14:00,17:30-19:00; Fr 08:00-14:00", "Sa-Mo 10:00-12:00; Tu 09:00-10:00"]) assert.ok(oneRulePerDay(s), s);
  for (const s of ["Mo-Fr 08:00-14:00; Mo-Th 17:30-19:00", "Mo-Fr 08:30-17:00; Tu,Th 17:30-19:00", "Sa-Mo 10:00-12:00; Su 09:00-10:00", "08:00-18:00; Sa 09:00-12:00"]) assert.ok(!oneRulePerDay(s), s);
});

// ---- every language (tools/hours-words.js) ----
test("lines about hours in other languages", () => {
  for (const s of ["Sprechzeiten", "Praxisöffnungszeiten:", "Pon.–Pt. 8:00–18:00", "Δευτέρα - Παρασκευή", "Графік роботи", "Lun-Ven 9h-12h et 14h30 à 19h",
    "Orari di apertura", "Horario de atención", "Åbningstider", "Aukioloajat", "Nyitvatartás", "Radno vrijeme", "Ordinační hodiny", "Notdienst",
    "Dyżur weterynaryjny", "Ügyelet", "Работно време", "Режим работы", "Mo–Fr 9 – 18 Uhr"]) assert.ok(aboutHours(s), s);
  for (const s of ["Wir lieben Tiere", "Notre équipe", "Il nostro staff", "Impressum", "© 2026", "Tel. 030 123 45 67", "Telefon: 089 12 34 56 78"]) assert.ok(!aboutHours(s), s);
});
test("page text around hours on a German page", () => {
  const t = relevantText(pageText("<h1>Tierarztpraxis Dr. Müller</h1><p>Unser Team</p><p>Lorem ipsum</p><p>x</p><p>y</p><p>z</p><h2>Sprechzeiten</h2><p>Mo, Di, Do 9–12 und 15–18 Uhr</p><p>Fr 9–12 Uhr</p>"));
  assert.ok(/Sprechzeiten[\s\S]*Fr 9–12 Uhr/.test(t), t);
  assert.ok(!/Tierarztpraxis/.test(t), t);
});
test("links in other languages: hours first, then contact, then the rest", () => {
  const html = '<a href="/team">Team</a><a href="/praxis/rundgang">Praxis</a><a href="/kontakt">Kontakt</a><a href="/oeffnungszeiten">Öffnungszeiten</a>';
  assert.deepStrictEqual(hoursLinks(html, "https://www.tierarzt.de/"), ["https://www.tierarzt.de/oeffnungszeiten", "https://www.tierarzt.de/kontakt", "https://www.tierarzt.de/praxis/rundgang"]);
  assert.deepStrictEqual(hoursLinks('<a href="/chi-siamo">Chi siamo</a><a href="/orari">Orari</a>', "https://vet.it/"), ["https://vet.it/orari"]);
  assert.deepStrictEqual(hoursLinks('<a href="/godziny-otwarcia/">Godziny</a>', "https://vet.pl/"), ["https://vet.pl/godziny-otwarcia/"]);
  assert.deepStrictEqual(hoursLinks('<a href="/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D0%B8">Контакти</a>', "https://vet.bg/"), ["https://vet.bg/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D0%B8"]);
});
test("round-the-clock evidence in other languages", () => {
  for (const s of ["Wir sind rund um die Uhr für Sie da", "urgences 24h/24", "Lecznica całodobowa", "цілодобово", "Pronto soccorso H24", "Ambulanta 0-24", "døgnåbent", "24 Std. Notdienst"]) assert.ok(roundTheClock(s), s);
  for (const s of ["Montag 8-18 Uhr", "24 Tiere", "Postcode 2400"]) assert.ok(!roundTheClock(s), s);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
