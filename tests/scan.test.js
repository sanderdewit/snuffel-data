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

test("UK member footer", "<footer>Proud member of the VetPartners family</footer>", "confirmed", "VetPartners");
test("UK trading-name line", "<p>Bay Vets is a trading name of Linnaeus Veterinary Limited</p>", "confirmed", "Linnaeus");
test("Italian membership", "<p>La clinica fa parte del Gruppo Animalia.</p>", "confirmed", "Gruppo Animalia");
test("Swedish membership", "<p>Vi är en del av Svenska Veterinärgruppen.</p>", "confirmed", "Vetopia");
test("links to a new group's privacy page", '<a href="https://www.vetpartners.co.uk/privacy-policy/">Privacy</a>', "confirmed", "VetPartners");

// Independents that merely cooperate / refer -> never confirmed
test("on-call rota + cooperation (was a false positive)",
  "<p>Wij zijn aangesloten bij de wachtgroep van Mechelen en werkt daarnaast ook samen met Anicura</p>", "possible");
test("out-of-hours referral", "<p>Buiten onze openingstijden kunt u contact opnemen met Evidensia Dierenziekenhuis Amsterdam</p>", "possible");
test("link to a group hospital page", '<a href="https://www.anicura.be/spoedklinieken/">Spoed</a>', "possible");
test("negative review of a chain", "<p>Door de hoge kosten bij het Evidensia dieren ziekenhuis ben ik verder gaan shoppen</p>", "possible");
test("no mention at all", "<p>Dierenartsenpraktijk De Linde, sinds 1985.</p>", "none");

// tools/safe-fetch.js: crawled URLs come from OSM, so internal addresses are refused.
const { isBlockedAddress, checkUrl } = require("../tools/safe-fetch.js");
async function check(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
(async () => {
  console.log("\nsafe fetch: address checks (no network)");
  await check("private, loopback, link-local, CGNAT, multicast, reserved IPv4 are blocked", () => {
    for (const ip of ["0.0.0.0", "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.255.254", "169.254.169.254",
                      "172.16.0.1", "172.31.255.255", "192.168.1.1", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255"]) {
      assert.ok(isBlockedAddress(ip), ip);
    }
  });
  await check("public IPv4 is allowed, including the edges of blocked ranges", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.0", "172.15.255.255", "172.32.0.0", "169.253.255.255", "192.167.255.255", "223.255.255.255", "11.0.0.0"]) {
      assert.ok(!isBlockedAddress(ip), ip);
    }
  });
  await check("IPv6 loopback, unspecified, ULA, link-local, multicast and mapped private IPv4 are blocked", () => {
    for (const ip of ["::1", "::", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "febf::1", "ff02::1",
                      "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "not an ip"]) {
      assert.ok(isBlockedAddress(ip), ip);
    }
  });
  await check("public IPv6 and mapped public IPv4 are allowed", () => {
    for (const ip of ["2001:4860:4860::8888", "2a00:1450:400e:80c::200e", "::ffff:8.8.8.8", "fec0::1", "2001:db8::1"]) {
      assert.ok(!isBlockedAddress(ip), ip);
    }
  });
  await check("only http(s) on the default ports, never to an internal IP literal", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/", "http://example.com:8080/", "https://example.com:22/",
                       "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/", "http://[::ffff:127.0.0.1]/", "http://0x7f000001/"]) {
      await assert.rejects(checkUrl(url), /blocked/, url);
    }
    await checkUrl("https://8.8.8.8/");
    await checkUrl("http://8.8.8.8:80/");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
