// Run with:  node tests/overture.test.js
// The rules that decide which Overture Maps places are published (tools/overture.js),
// with a stand-in for the website check: no network.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { merge, placeOf, write, read, checkFile, tidyCity, tidyStreet, pageVerdict, MIN_CONFIDENCE } = require("../tools/overture.js");

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const TODAY = "2026-11-22";
const cand = (id, extra) => Object.assign({ id, cat: "grooming", name: "Trimsalon " + id, lat: 52.1, lon: 5.1 + Number(id.replace(/\D/g, "")) * 0.01, conf: 0.5, src: ["BrightQuery"] }, extra);
// The website check: answers by site name
const answers = { "ok.nl": "ok", "down.nl": "error", "parked.nl": "parked", "other.nl": "off-topic", "robots.nl": "robots" };
const check = async (site) => answers[site] || "error";
const run = (candidates, prev, opts) => merge(Object.assign({ candidates, osm: [], prev: prev || new Map(), today: TODAY, check }, opts));
const ids = (r) => r.entries.map((e) => e.id).sort();

test("a confirmed website publishes a place, whatever the confidence", async () => {
  const r = await run([cand("a1", { site: "ok.nl" })]);
  assert.deepStrictEqual(ids(r), ["o-a1"]);
  assert.strictEqual(r.entries[0].siteOk, TODAY);
  assert.strictEqual(r.entries[0].since, TODAY);
});
test("a dead, parked or off-topic website keeps a new place out", async () => {
  const r = await run([cand("a1", { site: "down.nl", conf: 0.99 }), cand("a2", { site: "parked.nl" }), cand("a3", { site: "other.nl" })]);
  assert.deepStrictEqual(ids(r), []);
  assert.deepStrictEqual(r.log.dropped, { "website error": 1, "website parked": 1, "website off-topic": 1 });
});
test("without a website (or kept out by robots.txt): Overture's confidence decides", async () => {
  const r = await run([cand("a1", { conf: MIN_CONFIDENCE }), cand("a2", { conf: 0.6 }), cand("a3", { site: "robots.nl", conf: 0.9 }), cand("a4", { site: "robots.nl", conf: 0.5 })]);
  assert.deepStrictEqual(ids(r), ["o-a1", "o-a3"]);
});
test("a booking, social or short-link page counts as no website: confidence decides, the link stays", async () => {
  let asked = 0;
  const r = await run([cand("a1", { site: "https://booksy.com/pl-pl/123_salon", conf: 0.9 }), cand("a2", { site: "instagram.com/salon", conf: 0.5 }),
    cand("a3", { site: "https://g.page/salon", conf: 0.8 })], null, { check: async () => { asked++; return "error"; } });
  assert.deepStrictEqual(ids(r), ["o-a1", "o-a3"]);
  assert.strictEqual(asked, 0);                                   // never fetched
  assert.strictEqual(r.entries[0].site, "https://booksy.com/pl-pl/123_salon");
  assert.strictEqual(r.log.dropped["platform page, low confidence"], 1);
});
test("a website that fails is kept for 180 days after its last confirmation", async () => {
  const prev = new Map([["o-a1", { id: "o-a1", siteOk: "2026-07-01", since: "2026-06-01" }], ["o-a2", { id: "o-a2", siteOk: "2026-04-01", since: "2026-03-01" }]]);
  const r = await run([cand("a1", { site: "down.nl" }), cand("a2", { site: "down.nl" })], prev);
  assert.deepStrictEqual(ids(r), ["o-a1"]);
  assert.strictEqual(r.entries[0].siteOk, "2026-07-01");
  assert.strictEqual(r.entries[0].since, "2026-06-01");
  assert.strictEqual(r.log.removed, 1);
});
test("without website checks (--no-sites): published places stay, new ones with a website wait", async () => {
  const prev = new Map([["o-a1", { id: "o-a1", siteOk: "2026-11-01", since: "2026-11-01" }]]);
  const r = await run([cand("a1", { site: "ok.nl" }), cand("a2", { site: "ok.nl" }), cand("a3", { conf: 0.9 })], prev, { check: null });
  assert.deepStrictEqual(ids(r), ["o-a1", "o-a3"]);
});
test("OpenStreetMap wins: a shared name word within 150 m, or anything within 25 m", async () => {
  const osm = [
    { id: "n1", lat: 52.1, lon: 5.1101, tags: { name: "Bello Dierenwinkel", shop: "pet" } },        // ~75 m from a1
    { id: "n2", lat: 52.1009, lon: 5.12, tags: { name: "Kapsalon Mila" } },                         // ~100 m from a2, no shared word
    { id: "n3", lat: 52.10015, lon: 5.13, tags: { name: "Iets anders" } }                            // ~17 m from a3
  ];
  const r = await run([
    cand("a1", { name: "Trimsalon Bello", lon: 5.1112, conf: 0.9 }),    // ~75 m from n1, shares "bello"
    cand("a2", { name: "Hondentrimsalon Kees", conf: 0.9 }),
    cand("a3", { name: "Trimsalon Joop", conf: 0.9 })
  ], null, { osm });
  assert.deepStrictEqual(ids(r), ["o-a2"]);
  assert.strictEqual(r.log.inOsm, 2);
});
test("generic words are no evidence: 'Trimsalon X' near 'Trimsalon Y' are two places", async () => {
  const osm = [{ id: "n1", lat: 52.1, lon: 5.1105, tags: { name: "Hondentrimsalon Bello" } }];
  const r = await run([cand("a1", { name: "Trimsalon Anna", conf: 0.9 })], null, { osm });
  assert.deepStrictEqual(ids(r), ["o-a1"]);
});
test("Overture's own duplicates: the same name within 150 m, the most confident stays", async () => {
  const r = await run([cand("a1", { name: "Trimsalon Lola", conf: 0.8 }), cand("b1", { name: "TRIMSALON LOLA", lat: 52.1005, conf: 0.95 })]);
  assert.deepStrictEqual(ids(r), ["o-b1"]);
  assert.strictEqual(r.log.duplicate, 1);
});
test("categories not taken (vets, hospitals, dog parks) are skipped", async () => {
  const r = await run([cand("a1", { cat: "vet", conf: 0.99 }), cand("a2", { cat: "hospital", conf: 0.99 }), cand("a3", { cat: "play", conf: 0.99 })]);
  assert.deepStrictEqual(ids(r), []);
});
test("trainers: no walkers, groomers, masseurs or breeders unless a training word says so; no cat or horse trainers", async () => {
  const t = (id, name) => cand(id, { cat: "training", kind: "dog_trainer", name, conf: 0.9 });
  const r = await run([t("a1", "Hondenschool Be Brave"), t("a2", "Hondenuitlaatservice Bessing"), t("a3", "Hondentrimsalon Cynthia"),
    t("a4", "Boxerkennel Van 't Regge"), t("a5", "Uitlaatservice & Hondenschool Max"), t("a6", "Kattengedragstherapie Amsterdam"),
    t("a7", "Szkolenie Psów DAR-MAK"), t("a8", "Psie trenowanie i spacery"), t("a9", "Horse & Dog of Course")]);
  assert.deepStrictEqual(ids(r), ["o-a1", "o-a5", "o-a7", "o-a9"]);
  assert.deepStrictEqual(r.log.dropped, { "not a trainer (by name)": 4, "other animals only": 1 });
});
test("shelters: a shelter word in the name, and only on a confirmed website", async () => {
  const s = (id, name, extra) => cand(id, Object.assign({ cat: "shelter", kind: "animal_shelter", name, site: "ok.nl" }, extra));
  const r = await run([s("a1", "Dierenasiel Utrecht"), s("a2", "Schronisko dla Bezdomnych Zwierząt w Rybniku"),
    s("a3", "Centrum Opieki nad Zwierzętami Bezdomnymi"), s("a4", "Labrador Kennel Stars and Tails"), s("a5", "Hondentrimsalon Blaf"),
    s("a6", "Stichting Labrador Herplaatsing"), s("a7", "Kattenasiel Witte Gerrit"), s("a8", "Wildopvang Delft"),
    s("a9", "Dierenasiel Leiden", { site: undefined, conf: 0.99 }), s("a10", "Dierentehuis Hoorn", { site: "facebook.com/x", conf: 0.99 }),
    s("a11", "Dierenasiel Crailo", { site: "robots.nl", conf: 0.99 }), s("a12", "Dierenopvang Breda", { site: "other.nl" })]);
  assert.deepStrictEqual(ids(r), ["o-a1", "o-a2", "o-a3"]);
  assert.deepStrictEqual(r.log.dropped, { "no shelter word in the name": 3, "other animals only": 2, "shelter without a website": 2,
    "shelter, robots.txt": 1, "website off-topic": 1 });
});
test("shops: a shop word in the name or web address, or a chain; no webshops, no shops for fishing, aquaria or riding", async () => {
  const s = (id, name, extra) => cand(id, Object.assign({ cat: "shop", kind: "pet_store", name, conf: 0.9 }, extra));
  const r = await run([s("a1", "Dierenspeciaalzaak De Lange"), s("a2", "Sklep Zoologiczny Bajka"), s("a3", "Kwispel", { site: "ok.nl/" }),
    s("a3b", "Kwispel", { site: "http://www.dierenwinkelkwispel.nl", lat: 53 }), s("a4", "Snuffelkussens"), s("a5", "Kauwpret.nl"),
    s("a6", "Haps internetowy sklep zoologiczny"), s("a7", "Hengelsport Rotterdam"), s("a8", "Dieren & Hengelsport Nelis"),
    s("a9", "Sklep Wędkarski Szczupak"), s("a10", "Engelhart Aquaria"), s("a11", "Sklep Zoologiczny Pan i Kot"), s("a12", "Kattenshop Purrfect"),
    s("a13", "Sklep Zoologiczny multivet24.pl"), s("a14", "Bemelmans Ruitersport")], null, { check: async () => "ok" });
  assert.deepStrictEqual(ids(r), ["o-a1", "o-a11", "o-a13", "o-a2", "o-a3b", "o-a8"]);
  assert.deepStrictEqual(r.log.dropped, { "no shop word in the name or web address": 2, webshop: 2, "shop for other animals": 4, "other animals only": 1 });
});
test("chains: a brand OSM tags with brand:wikidata here (twice or more) is given to a shop with that brand in its name or address", async () => {
  const { detect } = require("../lib/chains.js");
  const osm = [{ lat: 51, lon: 4, tags: { shop: "pet", name: "Pets Place", brand: "Pets Place", "brand:wikidata": "Q116951772" } },
    { lat: 51.1, lon: 4, tags: { shop: "pet", name: "Pets Place", brand: "Pets Place", "brand:wikidata": "Q116951772" } },
    { lat: 51.2, lon: 4, tags: { shop: "pet", name: "Zoo Uno", brand: "Zoo Uno", "brand:wikidata": "Q1" } }];
  const s = (id, name, extra) => cand(id, Object.assign({ cat: "shop", kind: "pet_store", name, conf: 0.9 }, extra));
  const r = await run([s("a1", "Pet's Place Driebergen"), s("a2", "PetsPlace The Kingfish", { site: "https://www.petsplace.nl/" }),
    s("a3", "Dierenspeciaalzaak Zoo Uno"), s("a4", "Pets Placement Dierenwinkel"),
    s("a5", "Dierenwinkel Petsplaceshop", { site: "https://www.petsplaceshop.com/" }),
    s("a6", "Royal Canin", { site: "http://www.petsplace.nl/" }), s("a7", "Jumper Dierenspeciaalzaak", { site: "http://www.petsplace.nl" })],
  null, { osm, check: async () => "ok" });
  const by = Object.fromEntries(r.entries.map((e) => [e.id, e.brand || null]));
  assert.deepStrictEqual(by, { "o-a1": "Pets Place", "o-a2": "Pets Place", "o-a3": null, "o-a4": null, "o-a5": null, "o-a7": "Pets Place" });
  assert.deepStrictEqual(r.log.dropped, { "a chain's website, another name": 1 });   // "Royal Canin" at petsplace.nl
  const p = placeOf(r.entries.find((e) => e.id === "o-a1"));
  assert.strictEqual(p.tags["brand:wikidata"], "Q116951772");
  assert.deepStrictEqual(detect(p.tags, null, p.id), { group: "Pets Place", via: "osm" });
});
test("the published trainer, shelter and shop land in their categories", () => {
  const { classify } = require("../lib/classify.js");
  for (const cat of ["training", "shelter", "shop"]) {
    assert.strictEqual(classify(placeOf({ id: "o-c1", cat, name: "X", lat: 52, lon: 5, since: TODAY }).tags), cat);
  }
});
test("the website check: about dogs or grooming, in any language; short words only as whole words", () => {
  assert.strictEqual(pageVerdict("<h1>Trimsalon Bello</h1><p>Wij knippen en wassen uw hond.</p>", "grooming"), "ok");
  assert.strictEqual(pageVerdict("<title>Hundesalon Struppi</title>", "grooming"), "ok");
  assert.strictEqual(pageVerdict("<p>Salon pro psy a kočky</p>", "grooming"), "ok");
  assert.strictEqual(pageVerdict("<p>Kutyakozmetika Budapest</p>", "grooming"), "ok");
  assert.strictEqual(pageVerdict("<p>Welkom bij onze pastabar, pas op de passie</p>", "grooming"), "off-topic");
  assert.strictEqual(pageVerdict("<script>var dog=1</script><p>Loodgieter Jansen</p>", "grooming"), "off-topic");   // scripts don't count
  assert.strictEqual(pageVerdict("<p>Deze domeinnaam is te koop</p>", "grooming"), "parked");
  assert.strictEqual(pageVerdict("<p>This domain is for sale. Dog grooming</p>", "grooming"), "parked");
});
test("salons only for cats are left out; ones that also name dogs stay", async () => {
  const r = await run([cand("a1", { name: "Ilona's Kattensalon", conf: 0.9 }), cand("a2", { name: "The Catbarber", conf: 0.9 }),
    cand("a3", { name: "Trimsalon voor Hond & Kat", conf: 0.9 }), cand("a4", { name: "Trimsalon Katja", conf: 0.9 })]);
  assert.deepStrictEqual(ids(r), ["o-a3", "o-a4"]);
  assert.strictEqual(r.log.dropped["cats only"], 2);
});
test("boarding: places for other animals only are left out; ones that also take dogs stay", async () => {
  const b = (id, name) => cand(id, { cat: "boarding", kind: "pet_boarding", name, conf: 0.9 });
  const r = await run([b("a1", "Kattenpension Den Hoet"), b("a2", "Paardenpension De Lindehoef"), b("a3", "Honden- en kattenpension De Hoef"),
    b("a4", "Dierenpension Vogelzang"), b("a5", "Konijnenhotel Sammy")]);
  assert.deepStrictEqual(ids(r), ["o-a3", "o-a4"]);
  assert.strictEqual(r.log.dropped["other animals only"], 3);
});
test("boarding from Overture's broader categories needs a boarding word in the name; no rescues", async () => {
  const b = (id, kind, name) => cand(id, { cat: "boarding", kind, name, conf: 0.9 });
  const r = await run([b("a1", "dog_walker", "Hondenuitlaatservice Bas"), b("a2", "dog_walker", "Hondenopvang Bas"),
    b("a3", "pet_sitting", "Stichting Dierenopvang Dumpie"), b("a4", "pet_boarding", "Logeren bij Bella"),
    b("a5", "animal_or_pet_service", "Kennel van Tilburgs Roem"), b("a6", "pet_sitting", "Daisy's Doggy Daycare")]);
  assert.deepStrictEqual(ids(r), ["o-a2", "o-a4", "o-a6"]);
  assert.deepStrictEqual(r.log.dropped, { "no boarding word in the name": 2, "rescue or shelter": 1 });
});
test("the boarding website check wants dogs; grooming words alone don't count", () => {
  assert.strictEqual(pageVerdict("<p>Wij passen met liefde op uw hond.</p>", "boarding"), "ok");
  assert.strictEqual(pageVerdict("<p>Hotel dla psów, spacery i opieka</p>", "boarding"), "ok");
  assert.strictEqual(pageVerdict("<p>Wij verzorgen de vacht van uw kat tijdens zijn verblijf</p>", "boarding"), "off-topic");
  assert.strictEqual(pageVerdict("<p>Wij verzorgen de vacht van uw kat</p>", "grooming"), "ok");
});
test("the published boarding place gets amenity=animal_boarding, so it lands under boarding", () => {
  const { classify } = require("../lib/classify.js");
  const p = placeOf({ id: "o-b1", cat: "boarding", name: "Hondenopvang Bas", lat: 52.2, lon: 6.5, since: TODAY });
  assert.strictEqual(p.tags.amenity, "animal_boarding");
  assert.strictEqual(classify(p.tags), "boarding");
});
test("streets in capitals are tidied, a comma before the number goes", () => {
  assert.strictEqual(tidyStreet("VAN SPEYKSTRAAT 67"), "Van Speykstraat 67");
  assert.strictEqual(tidyStreet("Zieuwentseweg, 4A"), "Zieuwentseweg 4A");
  assert.strictEqual(tidyStreet("Riethovenseweg 10"), "Riethovenseweg 10");
});
test("city names in capitals are tidied", () => {
  assert.strictEqual(tidyCity("'S-GRAVENZANDE"), "'s-Gravenzande");
  assert.strictEqual(tidyCity("NIEUW-SCHOONEBEEK"), "Nieuw-Schoonebeek");
  assert.strictEqual(tidyCity("Den Haag"), "Den Haag");
});
test("the published place: grooming tags, address, contact, source and date", () => {
  const p = placeOf({ id: "o-a1", cat: "grooming", name: "Trimsalon A", street: "Dorpsstraat 1", city: "Goor", lat: 52.2, lon: 6.5,
    site: "https://a.nl/", conf: 0.5, since: "2026-11-01", siteOk: "2026-11-22" });
  assert.deepStrictEqual(p, { id: "o-a1", lat: 52.2, lon: 6.5, tags: { name: "Trimsalon A", shop: "pet_grooming", "addr:street": "Dorpsstraat 1",
    "addr:city": "Goor", website: "https://a.nl/", "snuffel:source": "overture", "snuffel:checked": "2026-11-22" } });
});
test("the register round-trips sorted, and check finds problems", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snuffel-overture-"));
  write("nl", [{ id: "o-bbbbbbbb", cat: "grooming", name: "B", lat: 52, lon: 5, conf: 0.9, since: TODAY },
               { id: "o-aaaaaaaa", cat: "grooming", name: "A", lat: 52, lon: 5, site: "x.nl", siteOk: TODAY, conf: 0.4, since: TODAY }], dir);
  assert.deepStrictEqual([...read("nl", dir).keys()], ["o-aaaaaaaa", "o-bbbbbbbb"]);
  assert.deepStrictEqual(checkFile("nl", dir), []);
  fs.writeFileSync(path.join(dir, "be.jsonl"), JSON.stringify({ id: "o-cccccccc", cat: "grooming", name: "C", lat: 50, lon: 4, conf: 0.3, since: TODAY }) + "\n");
  assert.match(checkFile("be", dir).join(), /neither a confirmed website nor enough confidence/);
  fs.writeFileSync(path.join(dir, "pl.jsonl"), [{ id: "o-dddddddd", cat: "shelter", name: "D", lat: 50, lon: 20, conf: 0.99, since: TODAY },
    { id: "o-eeeeeeee", cat: "shop", name: "E", lat: 50, lon: 20, conf: 0.99, brand: "Maxi Zoo", since: TODAY }].map((e) => JSON.stringify(e)).join("\n") + "\n");
  assert.match(checkFile("pl", dir).join(), /a shelter needs a confirmed website.*brand needs a wikidata id/);
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  console.log("overture places");
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("  ok  " + name); }
    catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
