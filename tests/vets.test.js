// Run with:  node tests/vets.test.js
// Our register of vets (tools/vets.js): refresh from OpenStreetMap, branches, hand fixes,
// opening hours from the scan (kept, confirmed, updated, expired), the published fields, check.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const V = require("../tools/vets.js");
const { siteToScan, structuredHours } = require("../tools/scan-hours.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const TODAY = "2026-11-21";
const osm = (id, lat, lon, tags, type = "node") => ({ type, id, lat, lon, tags });
const reg = (...entries) => new Map(entries.map((e) => [e.id, e]));
const refresh = (r, vets, fixes = {}, today = TODAY) => V.refresh(r, vets, fixes, today);
const later = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

// The example from the task: one practice, two locations, one website in OSM.
const VLEUTEN = osm(2761145310, 52.093833, 5.010187, { amenity: "veterinary", name: "Mark dierenarts", phone: "+31 30 662 0025",
  website: "https://www.markdierenarts.nl/", "addr:street": "Burchtwal", "addr:housenumber": "1", "addr:postcode": "3452MG", "addr:city": "Vleuten" });
const UTRECHT = osm(8585278251, 52.094919, 5.065368, { amenity: "veterinary", name: "Mark Dierenarts", phone: "030-6620025",
  opening_hours: "Mo-Fr 08:30-18:00", "addr:street": "Lissabonpromenade", "addr:housenumber": "73", "addr:postcode": "3541DP", "addr:city": "Utrecht" });
const OCTOBER = { opening_hours: "Mo-Fr 08:30-18:00; Sa 09:00-16:00", source: "ai", emergency: "on_call", emergency_phone: null,
  url: "https://www.markdierenarts.nl/", hash: "682434ace7ac2c8b", checked: "2026-10-11", hospital: false };

console.log("vet register");

test("phone numbers compare on their last 9 digits", () => {
  assert.strictEqual(V.phoneKey("+31 30 662 0025"), "306620025");
  assert.strictEqual(V.phoneKey("030-6620025"), "306620025");
  assert.strictEqual(V.phoneKey("0031306620025"), "306620025");
  assert.strictEqual(V.phoneKey("112"), null);
});
test("names share a distinctive word; generic words don't count", () => {
  assert.ok(V.sameName("Mark dierenarts", "Mark Dierenarts"));
  assert.ok(V.sameName("Dierenkliniek De Graaf", "Dierenartsenpraktijk De Graaf Zuid"));
  assert.ok(!V.sameName("Dierenarts", "Dierenkliniek"));
  assert.ok(V.sameName("Dierenarts", "dierenarts"));                 // only generic words: the whole name
  assert.ok(!V.sameName(undefined, undefined));
  assert.ok(!V.sameName("Dierenkliniek Noord", "Clinique Vétérinaire du Sud"));
  // other languages and scripts
  assert.ok(V.sameName("Przychodnia Weterynaryjna Azor", "Gabinet Weterynaryjny Azor"));
  assert.ok(!V.sameName("Przychodnia Weterynaryjna", "Lecznica Weterynaryjna"));
  assert.ok(V.sameName("Ветеринарна клиника Зоовет", "Зоовет"));
  assert.ok(!V.sameName("Ветеринарна клиника", "Ветеринарна клиника Здраве"));
  assert.ok(V.sameName("Tierarztpraxis Dr. Huber", "Kleintierklinik Huber"));
  assert.ok(!V.sameName("Κτηνιατρείο Παπαδόπουλος", "Κτηνιατρείο Νικολάου"));
});

test("refresh: new vets get OSM's facts and the run date", () => {
  const { reg: r, tally } = refresh(new Map(), [VLEUTEN, UTRECHT]);
  const v = r.get("n2761145310");
  assert.deepStrictEqual([v.name, v.street, v.postcode, v.city, v.phones, v.site, v.siteFrom, v.since],
    ["Mark dierenarts", "Burchtwal 1", "3452MG", "Vleuten", ["306620025"], "https://www.markdierenarts.nl/", "osm", TODAY]);
  assert.deepStrictEqual([r.get("n8585278251").hours, r.get("n8585278251").hoursFrom], ["Mo-Fr 08:30-18:00", "osm"]);
  assert.strictEqual(tally.new, 2);
  assert.strictEqual(tally.vets, 2);
});
test("refresh does not change the register it is given", () => {
  const old = reg({ id: "n1", name: "A", lat: 52, lon: 5, since: "2026-10-01" });
  refresh(old, [osm(2, 52, 5, { name: "A" })]);
  assert.deepStrictEqual(old.get("n1"), { id: "n1", name: "A", lat: 52, lon: 5, since: "2026-10-01" });
});
test("refresh: OSM's own website and hours win over the website scan and a branch", () => {
  const old = reg({ id: "n1", name: "Kliniek Aap", lat: 52, lon: 5, site: "https://branch.nl/", siteFrom: "branch:n9",
    hours: "Mo-Fr 09:00-17:00", hoursFrom: "ai", hoursUrl: "https://branch.nl/", hoursHash: "abc", hoursChecked: "2026-10-11", since: "2026-10-03" });
  const { reg: r } = refresh(old, [osm(1, 52, 5, { name: "Kliniek Aap", website: "https://aap.nl", opening_hours: "Mo-Sa 08:00-18:00" })]);
  const e = r.get("n1");
  assert.deepStrictEqual([e.site, e.siteFrom, e.hours, e.hoursFrom], ["https://aap.nl", "osm", "Mo-Sa 08:00-18:00", "osm"]);
  assert.ok(!e.hoursHash && !e.hoursChecked && !e.hoursUrl);
});
test("refresh: a value removed from OSM is removed here too (the scan may fill it again)", () => {
  const old = reg({ id: "n1", name: "Kliniek Aap", lat: 52, lon: 5, site: "https://aap.nl", siteFrom: "osm", hours: "Mo-Sa 08:00-18:00", hoursFrom: "osm", since: "2026-10-03" });
  const e = refresh(old, [osm(1, 52, 5, { name: "Kliniek Aap" })]).reg.get("n1");
  assert.ok(!e.site && !e.siteFrom && !e.hours && !e.hoursFrom);
});
test("refresh: website hours stay while OSM has none", () => {
  const old = reg({ id: "n1", name: "Kliniek Aap", lat: 52, lon: 5, site: "https://aap.nl", siteFrom: "osm",
    hours: "Mo-Fr 09:00-17:00", hoursFrom: "ai", hoursHash: "abc", hoursChecked: "2026-10-11", since: "2026-10-03" });
  const e = refresh(old, [osm(1, 52, 5, { name: "Kliniek Aap", website: "https://aap.nl" })]).reg.get("n1");
  assert.deepStrictEqual([e.hours, e.hoursFrom, e.hoursChecked], ["Mo-Fr 09:00-17:00", "ai", "2026-10-11"]);
});
test("refresh: the same clinic under a new OSM id keeps its facts (was: the old id)", () => {
  const old = reg({ id: "n1", name: "Kliniek Aap", lat: 52, lon: 5, phones: ["201234567"], hours: "Mo-Fr 09:00-17:00", hoursFrom: "ai",
    hoursChecked: "2026-10-11", since: "2026-10-03" });
  const { reg: r, tally } = refresh(old, [osm(55, 52.0009, 5, { name: "Dierenkliniek Aap" }, "way")]);   // 100 m away
  assert.ok(!r.has("n1"));
  assert.deepStrictEqual([r.get("w55").was, r.get("w55").hours], [["n1"], "Mo-Fr 09:00-17:00"]);
  assert.strictEqual(tally.moved, 1);
  // a renamed clinic with the same phone number counts too
  assert.ok(refresh(old, [osm(56, 52.0005, 5, { name: "Nieuwe naam", phone: "+31 20 123 4567" })]).reg.get("n56").was);
});
test("refresh: too far away, or another name and phone, is a new vet and the old one is gone", () => {
  const old = reg({ id: "n1", name: "Kliniek Aap", lat: 52, lon: 5, since: "2026-10-03" });
  const far = refresh(old, [osm(2, 52.003, 5, { name: "Kliniek Aap" })]);              // 330 m
  assert.deepStrictEqual([far.tally.new, far.tally.moved, far.tally.gone], [1, 0, 1]);
  assert.strictEqual(far.reg.get("n1").gone, TODAY);
  const other = refresh(old, [osm(2, 52, 5, { name: "Kliniek Noot" })]);
  assert.ok(!other.reg.get("n2").was && other.reg.get("n1").gone);
});
test("refresh: a vet gone from OSM is kept 90 days, then dropped; back under its own id it is live again", () => {
  const old = reg({ id: "n1", name: "Kliniek Aap", lat: 52, lon: 5, site: "https://aap.nl", siteFrom: "osm", since: "2026-10-03" });
  const month1 = refresh(old, []).reg;
  assert.deepStrictEqual([month1.get("n1").gone, month1.get("n1").since, month1.get("n1").site], [TODAY, "2026-10-03", "https://aap.nl"]);
  const still = refresh(month1, [], {}, later(TODAY, 90));
  assert.ok(still.reg.has("n1") && still.tally.gone === 1);
  const dropped = refresh(month1, [], {}, later(TODAY, 91));
  assert.ok(!dropped.reg.has("n1") && dropped.tally.dropped === 1);
  const back = refresh(month1, [osm(1, 52, 5, { name: "Kliniek Aap", website: "https://aap.nl" })], {}, later(TODAY, 30)).reg.get("n1");
  assert.ok(!back.gone && back.since === "2026-10-03");                     // since: its first run, not the last
});
test("refresh: a hand fix wins over OSM, also under an earlier id", () => {
  const fixes = { n1: { site: "https://www.aap-nieuw.nl/", hours: "Mo-Fr 08:00-17:00", checked: "2026-11-20", note: "phoned the clinic" } };
  const vets = [osm(1, 52, 5, { name: "Kliniek Aap", website: "https://aap.nl", opening_hours: "Mo-Fr 09:00-12:00" })];
  const { reg: r, tally } = refresh(new Map(), vets, fixes);
  const e = r.get("n1");
  assert.deepStrictEqual([e.site, e.siteFrom, e.hours, e.hoursFrom, e.hoursChecked], ["https://www.aap-nieuw.nl/", "manual", "Mo-Fr 08:00-17:00", "manual", "2026-11-20"]);
  assert.strictEqual(tally.manual, 1);
  const moved = refresh(r, [osm(77, 52.0002, 5, { name: "Kliniek Aap" })], fixes).reg.get("n77");
  assert.deepStrictEqual([moved.was, moved.siteFrom, moved.hoursFrom], [["n1"], "manual", "manual"]);
});
test("refresh: a hand fix taken out of the file no longer counts", () => {
  const fixes = { n1: { site: "https://www.aap-nieuw.nl/", hours: "Mo-Fr 08:00-17:00", checked: "2026-11-20", note: "phoned" } };
  const withOsm = [osm(1, 52, 5, { name: "Kliniek Aap", website: "https://aap.nl", opening_hours: "Mo-Fr 09:00-12:00" })];
  const fixed = refresh(new Map(), withOsm, fixes).reg;
  const back = refresh(fixed, withOsm, {}).reg.get("n1");
  assert.deepStrictEqual([back.site, back.siteFrom, back.hours, back.hoursFrom], ["https://aap.nl", "osm", "Mo-Fr 09:00-12:00", "osm"]);
  const bare = [osm(1, 52, 5, { name: "Kliniek Aap" })];
  const gone = refresh(refresh(new Map(), bare, fixes).reg, bare, {}).reg.get("n1");
  assert.ok(!gone.site && !gone.siteFrom && !gone.hours && !gone.hoursFrom && !gone.hoursChecked);
});

test("branches: a vet without a website gets its branch's (Mark Dierenarts, Utrecht from Vleuten)", () => {
  const { reg: r, tally } = refresh(new Map(), [VLEUTEN, UTRECHT]);
  const u = r.get("n8585278251");
  assert.deepStrictEqual([u.site, u.siteFrom], ["https://www.markdierenarts.nl/", "branch:n2761145310"]);
  assert.strictEqual(tally.branchSites, 1);
});
test("branches: not without a shared name, beyond 40 km, or from a branch-derived website", () => {
  const otherName = { ...UTRECHT, tags: { ...UTRECHT.tags, name: "Dierenkliniek Leidsche Rijn" } };
  assert.ok(!refresh(new Map(), [VLEUTEN, otherName]).reg.get("n8585278251").site);
  const far = { ...UTRECHT, lat: 52.6 };   // ~56 km
  assert.ok(!refresh(new Map(), [VLEUTEN, far]).reg.get("n8585278251").site);
  const third = osm(3, 52.1, 5.1, { name: "Mark dierenarts", phone: "+31 30 662 0025" });
  const r = refresh(new Map(), [VLEUTEN, UTRECHT, third]).reg;
  assert.strictEqual(r.get("n3").siteFrom, "branch:n2761145310");            // from the branch with its own website
});
test("branches: one group number with different clinic pages gives nobody a website", () => {
  const group = (id, lat, site) => osm(id, lat, 4.9, Object.assign({ name: "Dierenkliniek Zeemeeuw", phone: "088 123 4567" }, site ? { website: site } : {}));
  const r = refresh(new Map(), [group(1, 52.30, "https://zeemeeuw.nl/amsterdam"), group(2, 52.38, "https://zeemeeuw.nl/haarlem"), group(3, 52.44, null)]).reg;
  assert.ok(!r.get("n3").site);
  const same = refresh(new Map(), [group(1, 52.30, "https://zeemeeuw.nl/"), group(2, 52.38, "https://www.zeemeeuw.nl"), group(3, 52.44, null)]).reg;
  assert.strictEqual(same.get("n3").site, "https://www.zeemeeuw.nl");          // the same site written two ways; the nearest branch
  // a link made earlier goes when a second clinic page appears
  const before = refresh(new Map(), [group(1, 52.30, "https://zeemeeuw.nl/amsterdam"), group(3, 52.44, null)]).reg;
  assert.strictEqual(before.get("n3").siteFrom, "branch:n1");
  const after = refresh(before, [group(1, 52.30, "https://zeemeeuw.nl/amsterdam"), group(2, 52.38, "https://zeemeeuw.nl/haarlem"), group(3, 52.44, null)]).reg;
  assert.ok(!after.get("n3").site && !after.get("n3").siteFrom);
});
test("branches: a gone branch passes nothing on", () => {
  const first = refresh(new Map(), [VLEUTEN, UTRECHT]).reg;
  const u = refresh(first, [UTRECHT]).reg.get("n8585278251");
  assert.ok(!u.site && !u.siteFrom);
});

test("hours: an answer is taken, a failed or empty scan keeps it with its date", () => {
  const r = refresh(new Map(), [VLEUTEN, UTRECHT]).reg;
  const oct = V.takeHours(r, { places: { n2761145310: OCTOBER } }, "2026-10-11");
  const v = r.get("n2761145310");
  assert.deepStrictEqual([v.hours, v.hoursFrom, v.hoursUrl, v.hoursHash, v.hoursChecked], [OCTOBER.opening_hours, "ai", OCTOBER.url, OCTOBER.hash, "2026-10-11"]);
  assert.deepStrictEqual([v.emergency, v.emergencyChecked], ["on_call", "2026-10-11"]);
  assert.strictEqual(oct.updated, 1);
  const nov = V.takeHours(r, { places: {} }, TODAY);                          // the site failed in November
  assert.deepStrictEqual([v.hours, v.hoursChecked, v.emergency], [OCTOBER.opening_hours, "2026-10-11", "on_call"]);
  assert.deepStrictEqual([nov.kept, nov.updated, nov.expired], [1, 0, 0]);
  V.takeHours(r, {}, TODAY);                                                  // no scan file at all
  assert.strictEqual(v.hours, OCTOBER.opening_hours);
});
test("hours: the same answer confirms (new date), another answer replaces", () => {
  const r = refresh(new Map(), [VLEUTEN]).reg;
  V.takeHours(r, { places: { n2761145310: OCTOBER } }, "2026-10-11");
  const t1 = V.takeHours(r, { places: { n2761145310: { ...OCTOBER, checked: "2026-12-03" } } }, "2026-12-03");
  assert.strictEqual(t1.confirmed, 1);
  assert.strictEqual(r.get("n2761145310").hoursChecked, "2026-12-03");
  const t2 = V.takeHours(r, { places: { n2761145310: { ...OCTOBER, opening_hours: "Mo-Fr 08:00-18:00", source: "structured", hash: "def", checked: "2027-01-03" } } }, "2027-01-03");
  assert.strictEqual(t2.updated, 1);
  assert.deepStrictEqual([r.get("n2761145310").hours, r.get("n2761145310").hoursFrom, r.get("n2761145310").hoursHash], ["Mo-Fr 08:00-18:00", "structured", "def"]);
});
test("hours: an earlier answer with a day in two rules is not kept", () => {
  const r = refresh(new Map(), [VLEUTEN]).reg;
  V.takeHours(r, { places: { n2761145310: { ...OCTOBER, opening_hours: "Mo-Fr 08:30-17:00; Tu,Th 17:30-19:00" } } }, "2026-10-11");
  const t = V.takeHours(r, { places: {} }, TODAY);
  assert.ok(!r.get("n2761145310").hours && !r.get("n2761145310").hoursFrom);
  assert.strictEqual(t.ambiguous, 1);
});
test("hours: website facts without a confirmation for 180 days expire", () => {
  const r = refresh(new Map(), [VLEUTEN]).reg;
  V.takeHours(r, { places: { n2761145310: OCTOBER } }, "2026-10-11");
  V.takeHours(r, {}, later("2026-10-11", 180));
  assert.strictEqual(r.get("n2761145310").hours, OCTOBER.opening_hours);
  const t = V.takeHours(r, {}, later("2026-10-11", 181));
  const v = r.get("n2761145310");
  assert.ok(!v.hours && !v.hoursFrom && !v.hoursHash && !v.hoursChecked && !v.emergency && !v.emergencyChecked);
  assert.deepStrictEqual([t.expired, t.kept], [1, 0]);
});
test("hours: OSM's own and hand-fixed hours are never replaced or expired by the scan", () => {
  const fixes = { n2761145310: { hours: "Mo-Fr 08:00-17:30", checked: "2025-01-01", note: "phoned" } };
  const r = refresh(new Map(), [VLEUTEN, UTRECHT], fixes).reg;
  V.takeHours(r, { places: { n2761145310: OCTOBER, n8585278251: OCTOBER } }, TODAY);
  assert.deepStrictEqual([r.get("n2761145310").hours, r.get("n2761145310").hoursFrom], ["Mo-Fr 08:00-17:30", "manual"]);
  assert.deepStrictEqual([r.get("n8585278251").hours, r.get("n8585278251").hoursFrom], ["Mo-Fr 08:30-18:00", "osm"]);
  assert.strictEqual(r.get("n8585278251").emergency, "on_call");             // emergency info is still taken
});
test("hours: an emergency-only answer leaves the hours alone", () => {
  const r = refresh(new Map(), [VLEUTEN]).reg;
  V.takeHours(r, { places: { n2761145310: OCTOBER } }, "2026-10-11");
  V.takeHours(r, { places: { n2761145310: { opening_hours: null, source: null, emergency: "24/7", emergency_phone: "030 123 4567", hospital: true, checked: TODAY } } }, TODAY);
  const v = r.get("n2761145310");
  assert.deepStrictEqual([v.hours, v.hoursChecked, v.emergency, v.emergencyPhone, v.hospital, v.emergencyChecked],
    [OCTOBER.opening_hours, "2026-10-11", "24/7", "030 123 4567", true, TODAY]);
});
test("previous answer for the scan: only for website hours with a page hash", () => {
  const r = refresh(new Map(), [VLEUTEN, UTRECHT]).reg;
  assert.strictEqual(V.previousFor(r.get("n8585278251")), undefined);
  V.takeHours(r, { places: { n2761145310: OCTOBER } }, "2026-10-11");
  const p = V.previousFor(r.get("n2761145310"));
  assert.deepStrictEqual([p.opening_hours, p.source, p.hash, p.emergency, p.url], [OCTOBER.opening_hours, "ai", OCTOBER.hash, "on_call", OCTOBER.url]);
});
test("which site the scan reads: a hand fix, then OSM's own, then a branch's (shared)", () => {
  assert.deepStrictEqual(siteToScan({ website: "https://osm.nl" }, { site: "https://fix.nl", siteFrom: "manual" }), { url: "https://fix.nl", shared: false });
  assert.deepStrictEqual(siteToScan({ website: "https://osm.nl" }, { site: "https://osm.nl", siteFrom: "osm" }), { url: "https://osm.nl", shared: false });
  assert.deepStrictEqual(siteToScan({}, { site: "https://branch.nl", siteFrom: "branch:n1" }), { url: "https://branch.nl", shared: true });
  assert.deepStrictEqual(siteToScan({ "contact:website": "osm.nl" }, undefined), { url: "osm.nl", shared: false });
  assert.deepStrictEqual(siteToScan({}, undefined), { url: null, shared: false });
});
test("a branch's site: structured hours only for this vet's postcode", () => {
  const ld = '<script type="application/ld+json">' + JSON.stringify({ "@type": "VeterinaryCare", address: { postalCode: "3452 MG" }, openingHours: "Mo-Fr 08:30-18:00; Sa 09:00-16:00" }) + "</script>";
  assert.strictEqual(structuredHours(ld, { tags: { "addr:postcode": "3541DP" } }, true), null);
  assert.strictEqual(structuredHours(ld, { tags: { "addr:postcode": "3452MG" } }, true), "Mo-Fr 08:30-18:00; Sa 09:00-16:00");
  assert.strictEqual(structuredHours(ld, { tags: { "addr:postcode": "3541DP" } }, false), "Mo-Fr 08:30-18:00; Sa 09:00-16:00");
});

test("published fields: only what OSM doesn't have, with the date it was checked", () => {
  const r = refresh(new Map(), [VLEUTEN, UTRECHT]).reg;
  V.takeHours(r, { places: { n2761145310: OCTOBER } }, "2026-10-11");
  assert.deepStrictEqual(V.placeFields(r.get("n2761145310"), VLEUTEN.tags),
    { "snuffel:opening_hours": OCTOBER.opening_hours, "snuffel:emergency": "on_call", "snuffel:checked": "2026-10-11" });
  assert.deepStrictEqual(V.placeFields(r.get("n8585278251"), UTRECHT.tags), { "snuffel:website": "https://www.markdierenarts.nl/" });
  assert.deepStrictEqual(V.placeFields(undefined, {}), {});
});
test("published fields: OSM's own website and hours are never hidden, not even by a hand fix", () => {
  const fixes = { n2761145310: { site: "https://fix.nl/", note: "x" }, n8585278251: { hours: "Mo-Fr 08:00-17:00", checked: TODAY, note: "x" } };
  const r = refresh(new Map(), [VLEUTEN, UTRECHT], fixes).reg;
  assert.deepStrictEqual(V.placeFields(r.get("n2761145310"), VLEUTEN.tags), {});
  assert.deepStrictEqual(V.placeFields(r.get("n8585278251"), UTRECHT.tags), { "snuffel:website": "https://fix.nl/" });   // the branch's fixed site
  const emergencyOnly = { id: "n5", emergency: "24/7", emergencyPhone: "112 0", emergencyChecked: "2026-11-03", since: TODAY };
  assert.deepStrictEqual(V.placeFields(emergencyOnly, {}), { "snuffel:emergency": "24/7", "snuffel:emergency_phone": "112 0", "snuffel:checked": "2026-11-03" });
});

// ---- the files and the command line ----------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snuffel-vets-"));
const dir = path.join(tmp, "vets"), cache = path.join(tmp, "cache");
fs.mkdirSync(cache, { recursive: true });
const tool = path.join(__dirname, "..", "tools", "vets.js");
const env = (today) => Object.assign({}, process.env, { SNUFFEL_VETS: dir, SNUFFEL_CACHE: cache, SNUFFEL_TOOLS: tmp, SNUFFEL_TODAY: today });
const run = (args, today = TODAY) => spawnSync("node", [tool, ...args], { env: env(today), encoding: "utf8" });

test("write and read: one sorted line per vet, empty fields left out", () => {
  const r = refresh(new Map(), [UTRECHT, VLEUTEN, osm(5, 52, 5, { name: "X" }, "way")]).reg;
  V.write("nl", r, dir);
  const lines = fs.readFileSync(path.join(dir, "nl.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepStrictEqual(lines.map((e) => e.id), ["n2761145310", "n8585278251", "w5"]);
  assert.deepStrictEqual(Object.keys(lines[2]), ["id", "name", "lat", "lon", "since"]);
  assert.deepStrictEqual(V.read("nl", dir).get("n8585278251"), lines[1]);
  fs.rmSync(dir, { recursive: true, force: true });
});
test("command line: update, hours, check, summary", () => {
  fs.writeFileSync(path.join(cache, "osm-vets-nl.json"), JSON.stringify([VLEUTEN, UTRECHT]));
  const u = run(["update", "nl"], "2026-10-11");
  assert.strictEqual(u.status, 0, u.stderr);
  fs.writeFileSync(path.join(tmp, "hours-nl.json"), JSON.stringify({ places: { n2761145310: OCTOBER } }));
  assert.strictEqual(run(["hours", "nl"], "2026-10-11").status, 0);
  fs.rmSync(path.join(tmp, "hours-nl.json"));                                 // November: the scan found nothing
  assert.strictEqual(run(["update", "nl"]).status, 0);
  const h = run(["hours", "nl"]);
  assert.match(h.stdout, /no scan this run.*"kept":1/);
  const v = V.read("nl", dir).get("n2761145310");
  assert.deepStrictEqual([v.hours, v.hoursChecked, v.since], [OCTOBER.opening_hours, "2026-10-11", "2026-10-11"]);
  const c = run(["check"]);
  assert.strictEqual(c.status, 0, c.stdout);
  assert.match(run(["summary"]).stdout, /^nl: 2 vets; website 2 \(osm 1, branch 1\); opening hours 2 \(osm 1, website 1\); emergency info 1$/m);
});
test("command line: a month without changes leaves the file as it was (the commit shows only real changes)", () => {
  const before = fs.readFileSync(path.join(dir, "nl.jsonl"), "utf8");
  assert.strictEqual(run(["update", "nl"], "2026-12-03").status, 0);
  assert.strictEqual(run(["hours", "nl"], "2026-12-03").status, 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, "nl.jsonl"), "utf8"), before);
});
test("command line: a truncated OSM extract doesn't make the register gone", () => {
  const many = Array.from({ length: 30 }, (_, i) => osm(100 + i, 52 + i / 100, 5, { name: "Kliniek " + i }));
  fs.writeFileSync(path.join(cache, "osm-vets-be.json"), JSON.stringify(many));
  assert.strictEqual(run(["update", "be"]).status, 0);
  fs.writeFileSync(path.join(cache, "osm-vets-be.json"), JSON.stringify(many.slice(0, 10)));
  const r = run(["update", "be"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /only 10 vets/);
  assert.strictEqual([...V.read("be", dir).values()].filter((e) => !e.gone).length, 30);
});
test("check: finds broken lines and hand fixes without a note or date", () => {
  const bad = path.join(tmp, "bad");
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, "nl.jsonl"), [
    JSON.stringify({ id: "n2", since: TODAY }),
    JSON.stringify({ id: "n1", since: TODAY }),                                            // not sorted
    JSON.stringify({ id: "n3", site: "https://a.nl", since: TODAY }),                     // site without siteFrom
    JSON.stringify({ id: "n4", hours: "Ma-Vr 9-17", hoursFrom: "ai", hoursChecked: TODAY, since: TODAY }),
    JSON.stringify({ id: "n5", hours: "Mo-Fr 09:00-17:00", hoursFrom: "ai", since: TODAY }), // no checked date
    JSON.stringify({ id: "n6", hours: "Mo-Fr 09:00-17:00 || \"by appointment\"", hoursFrom: "osm" }),   // OSM's own syntax is fine; no since date
    JSON.stringify({ id: "x-nl-1", since: TODAY }),                                        // bad id
    "{ broken"
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(bad, "overrides.json"), JSON.stringify({ about: "x", vets: {
    n1: { hours: "Mo-Fr 09:00-17:00", note: "phoned" },
    n2: { site: "https://ok.nl/", checked: TODAY },
    n3: { site: "ok.nl", note: "x" },
    w4: { site: "https://ok.nl/", note: "checked the clinic's own site" }
  } }));
  const { files, problems } = V.check(bad);
  const has = (re) => assert.ok(problems.some((p) => re.test(p)), re + "\n" + problems.join("\n"));
  assert.strictEqual(files, 1);
  has(/nl\.jsonl:2 not sorted/); has(/nl\.jsonl:7 bad id/); has(/n3 site without a valid siteFrom/);
  has(/n4 hours not valid/); has(/n5 hours without a checked date/); has(/n6 without a since date/); has(/nl\.jsonl:8 invalid JSON/);
  has(/overrides\.json: n1 hours need a checked date/); has(/overrides\.json: n2 needs a note/); has(/overrides\.json: n3 site is not an http/);
  assert.ok(!problems.some((p) => /n6 hours/.test(p) || /w4/.test(p)), problems.join("\n"));
  assert.strictEqual(problems.length, 10, problems.join("\n"));
});
test("the register in this repository passes the check", () => {
  const { problems } = V.check(path.join(__dirname, "..", "vets"));
  assert.deepStrictEqual(problems, []);
});
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
