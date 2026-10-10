// Run with:  node tests/scan.test.js
// Real snippets from clinic websites (NL / BE / DE scans) and the verdict each must get.
"use strict";
const assert = require("assert");
const { analyse } = require("../tools/scan-websites.js");

const page = (body) => `<html><body>${body}</body></html>`;
let passed = 0, failed = 0;
function test(name, html, verdict, group) {
  try {
    const r = analyse(page(html));
    assert.strictEqual(r.verdict, verdict, `verdict ${r.verdict} (${r.evidence || ""})`);
    if (group) assert.strictEqual(r.group, group);
    passed++; console.log("  ok  " + name);
  } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log("website ownership classifier");

// Owned by a group -> confirmed
test("NL footer legal entity", "<footer>KvK 123 · Evidensia Dierenklinieken B.V.</footer>", "confirmed", "Evidensia");
test("copyright line", "<p>Copyright &copy 2026 Dierenkliniek Thorbeckelaan Geregistreerde bedrijfsnaam: Evidensia</p>", "confirmed", "Evidensia");
test("membership phrase", "<p>Wij zijn onderdeel van de AniCura familie.</p>", "confirmed", "AniCura");
test("German Impressum entity", "<p>Betreiber: AniCura Deutschland GmbH, Hamburg</p>", "confirmed", "AniCura");
test("French membership", "<p>Notre clinique fait partie du réseau Evidensia.</p>", "confirmed", "Evidensia");
test("links to the group's terms page", '<a href="https://evidensia.be/algemene-voorwaarden/">Voorwaarden</a>', "confirmed", "Evidensia");
test("links to the group's French T&Cs", '<a href="https://evidensia.be/fr/tcg/">CG</a>', "confirmed", "Evidensia");

// Independents that merely cooperate / refer -> never confirmed
test("on-call rota + cooperation (was a false positive)",
  "<p>Wij zijn aangesloten bij de wachtgroep van Mechelen en werkt daarnaast ook samen met Anicura</p>", "possible");
test("out-of-hours referral", "<p>Buiten onze openingstijden kunt u contact opnemen met Evidensia Dierenziekenhuis Amsterdam</p>", "possible");
test("link to a group hospital page", '<a href="https://www.anicura.be/spoedklinieken/">Spoed</a>', "possible");
test("negative review of a chain", "<p>Door de hoge kosten bij het Evidensia dieren ziekenhuis ben ik verder gaan shoppen</p>", "possible");
test("no mention at all", "<p>Dierenartsenpraktijk De Linde, sinds 1985.</p>", "none");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
