#!/usr/bin/env node
/* ============================================================================
 * Snuffel — places that OpenStreetMap lacks, from Overture Maps
 *
 * OpenStreetMap has about 100 of the Netherlands' thousands of dog grooming
 * salons. Overture Maps (open data: business registers and public pages,
 * CDLA-Permissive-2.0) has most of them, with closed and stale ones among them.
 * overture/<cc>.jsonl lists the ones we publish, after these checks:
 *
 *   - OpenStreetMap wins: a candidate within 150 m of an OSM place with a name
 *     word in common (or within 25 m) is left out, so nothing appears twice.
 *   - With a website: published when the site answers and is about dogs or
 *     grooming (its home page, robots.txt honoured), and kept while a later run
 *     can't reach it for up to KEEP_DAYS after the last confirmation.
 *   - Without a website, or one robots.txt keeps us out of: published when
 *     Overture's own confidence is at least MIN_CONFIDENCE.
 *   - Gone from Overture, closed there, or now in OSM: removed.
 * Many salons are run from home: the checks above keep old registrations at
 * private addresses out, and nothing else about a place is stored.
 *
 *   python3 tools/overture.py <cc>          this run's candidates (tools/.cache/overture-<cc>.jsonl)
 *   node tools/overture.js update <cc> [--no-sites]
 *        the candidates against this run's OSM places (dist/stage/<cc>.json) and the
 *        register; --no-sites: no website checks (new places with a website wait)
 *   node tools/overture.js check     validate overture/*.jsonl
 *   node tools/overture.js summary   one line per country
 *
 * One line per place, sorted by id. Fields: id ("o-" + Overture id), cat (our
 * category), name, street, postcode, city, lat, lon, phone, site, conf (Overture's
 * confidence), src (Overture's sources), siteOk (date the website last confirmed
 * it), since (first run it was published).
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { foldName, GROOMING } = require("../lib/classify.js");
const { safeFetch, readCapped } = require("./safe-fetch.js");
const { robotsBody } = require("./robots-match.js");

const ROOT = path.join(__dirname, "..");
const DIR = process.env.SNUFFEL_OVERTURE || path.join(ROOT, "overture");
const CACHE = process.env.SNUFFEL_CACHE || path.join(__dirname, ".cache");
const DIST = process.env.SNUFFEL_DIST || path.join(ROOT, "dist");
const MIN_CONFIDENCE = 0.77;
const KEEP_DAYS = 180;
const SAME_PLACE_M = 150, SAME_SPOT_M = 25;
const UA = "Mozilla/5.0 (compatible; SnuffelBot/1.0; dog-services directory, website check)";
const CONCURRENCY = 6, TIMEOUT_MS = 15000, MAX_BYTES = 600000;
const ORDER = ["id", "cat", "name", "street", "postcode", "city", "lat", "lon", "phone", "site", "conf", "src", "siteOk", "since"];
const CATS = ["grooming"];
// The tags a published place gets, so the site and app put it in the right category.
const CAT_TAGS = { grooming: { shop: "pet_grooming" } };

// ---- helpers ---------------------------------------------------------------------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
function metres(a, b) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}
// Words that say what a place is, not which one it is: no evidence that two names match.
const GENERIC = new Set(("trimsalon hondentrimsalon trimster hondenkapsalon hondensalon salon grooming groomer dog dogs pet pets " +
  "hond honden hondjes dier dieren dierenspeciaalzaak dierenwinkel de het een van en voor bij the and").split(" "));
function nameWords(s) {
  return new Set(foldName(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w)));
}
const shareWord = (a, b) => { const x = nameWords(a); for (const w of nameWords(b)) if (x.has(w)) return true; return false; };

/** "'S-GRAVENZANDE" -> "'s-Gravenzande", "VOORBURG" -> "Voorburg"; mixed case stays. */
function tidyCity(s) {
  if (!s || s !== s.toUpperCase()) return s || undefined;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase()).replace(/^'S-/i, "'s-");
}
/** "VAN SPEYKSTRAAT 67" -> "Van Speykstraat 67", "Zieuwentseweg, 4A" -> "Zieuwentseweg 4A". */
function tidyStreet(s) {
  if (!s) return undefined;
  return tidyCity(s.trim()).replace(/,\s*(?=\d)/, " ");
}
// A salon only for cats ("Kattensalon", "The Catbarber"): not for a dog app. One that
// also names dogs ("Trimsalon voor hond & kat") stays.
const CAT_RE = /(^|[^a-z])(katten|kat(salon|trim|kapper|verzorg)|kat|poes|poezen|cats?|catbarber|catgroom\w*|katze|gatto|gato)([^a-z]|$)/;
const DOG_NAME_RE = /hond|hund|dog|chien|cane|perro|pies|psi|koira|kutya/;
function catOnly(name) {
  const n = foldName(name);
  return CAT_RE.test(n.replace(/(katten|kat)(salon|trim|kapper|verzorg|huis|kenner|bus)/g, "$1 $2")) && !DOG_NAME_RE.test(n);
}

// ---- the register ----------------------------------------------------------------
function file(cc, dir) { return path.join(dir || DIR, cc + ".jsonl"); }
function read(cc, dir) {
  const f = file(cc, dir), out = new Map();
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) if (line.trim()) { const e = JSON.parse(line); out.set(e.id, e); }
  return out;
}
function write(cc, entries, dir) {
  const lines = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => {
    const o = {};
    for (const k of ORDER) if (e[k] !== undefined && e[k] !== null && e[k] !== "") o[k] = e[k];
    return JSON.stringify(o);
  });
  fs.mkdirSync(dir || DIR, { recursive: true });
  fs.writeFileSync(file(cc, dir), lines.join("\n") + (lines.length ? "\n" : ""));
}

// ---- the website check -----------------------------------------------------------
// The page talks about dogs or grooming: the grooming phrases of every language
// (lib/classify.js), and "dog" in the languages of Snuffel's countries, as the start
// of a word ("honden", "Hundesalon") or, for short words, as a whole word. Short words
// that mean something else in another language are left out (Dutch "pas", Catalan
// "pes", Italian "suo", Albanian "pse", Dutch "cao"/"koers"); per-country word lists
// can replace this when categories or countries need them.
const DOG_PREFIX = ["hond", "hund", "dog", "chien", "perro", "gossos", "koira", "koerte", "koera", "kutya", "caine", "catel",
  "pies", "psow", "psov", "cani", "куче", "кучиња", "кучет", "σκυλ", "собак", "trim", "groom", "toilett", "vacht"];
const DOG_WHOLE = ["koer", "cane", "caes", "suni", "sunu", "psy", "psa", "qen", "пес", "пси"];
const esc = (w) => foldName(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GROOM_RE = new RegExp([
  "(" + [...new Set(Object.values(GROOMING).flat())].map(esc).join("|") + ")",
  "(?:^|[^\\p{L}])(" + DOG_PREFIX.map(esc).join("|") + ")",
  "(?:^|[^\\p{L}])(" + DOG_WHOLE.map(esc).join("|") + ")(?![\\p{L}])"
].join("|"), "u");
const PARKED_RE = /domain(name)? (is )?for sale|buy this domain|this domain (name )?(is|has been) (registered|parked|for sale)|domein(naam)? (is )?te koop|parked (free )?(by|domain)|sedoparking|domain parking/i;
const TOPIC = { grooming: GROOM_RE };

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const { response: r } = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal });
    return { ok: r.ok, html: await readCapped(r, MAX_BYTES) };
  } finally { clearTimeout(timer); }
}
async function robotsAllows(origin) {
  try {
    const { ok, html } = await fetchText(origin + "/robots.txt");
    if (!ok) return true;
    let applies = false;
    for (const raw of robotsBody(html).split(/\r?\n/)) {
      const m = raw.replace(/#.*/, "").trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      if (m[1].toLowerCase() === "user-agent") applies = m[2].trim() === "*" || /snuffel/i.test(m[2]);
      else if (applies && m[1].toLowerCase() === "disallow" && m[2].trim() === "/") return false;
    }
    return true;
  } catch (e) { return true; }
}
/** "ok" | "off-topic" | "parked": what a home page's HTML says about a place of category `cat`. */
function pageVerdict(html, cat) {
  const text = foldName(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  if (PARKED_RE.test(text)) return "parked";
  return (TOPIC[cat] || GROOM_RE).test(text) ? "ok" : "off-topic";
}
/** "ok" | "off-topic" | "parked" | "robots" | "error": what the site's home page says. */
async function checkSite(site, cat) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(site) ? site : "http://" + site); } catch (e) { return "error"; }
  if (!(await robotsAllows(url.origin))) return "robots";
  try {
    const { ok, html } = await fetchText(url.href);
    return ok ? pageVerdict(html, cat) : "error";
  } catch (e) { return "error"; }
}
/** Runs `fn` over the sites, CONCURRENCY at a time and one request per host at a time. */
async function checkAll(items, fn) {
  const byHost = new Map();
  for (const it of items) {
    let host; try { host = new URL(/^https?:\/\//i.test(it.site) ? it.site : "http://" + it.site).host; } catch (e) { host = it.site; }
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(it);
  }
  const queue = [...byHost.values()], out = new Map();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let group; (group = queue.shift());) for (const it of group) out.set(it.id, await fn(it.site, it.cat));
  }));
  return out;
}

// ---- update ----------------------------------------------------------------------
/**
 * The new register from this run's candidates. `check(site, cat)` answers like
 * checkSite; null means no website checks this run. Returns { entries, log }.
 */
async function merge({ candidates, osm, prev, today, check }) {
  const log = { candidates: candidates.length, inOsm: 0, duplicate: 0, bySite: 0, byConfidence: 0, keptUnreachable: 0, dropped: {}, added: 0, removed: 0 };
  const drop = (why) => { log.dropped[why] = (log.dropped[why] || 0) + 1; };
  // OSM places on a coarse grid (about 1 km), to look only at the neighbours
  const grid = new Map(), key = (lat, lon) => Math.floor(lat * 100) + "_" + Math.floor(lon * 60);
  for (const p of osm) { const k = key(p.lat, p.lon); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  const near = (c) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const p of grid.get((Math.floor(c.lat * 100) + dy) + "_" + (Math.floor(c.lon * 60) + dx)) || []) out.push(p);
    }
    return out;
  };
  const inOsm = (c) => near(c).some((p) => { const d = metres(c, p); return d < SAME_SPOT_M || (d < SAME_PLACE_M && shareWord(c.name, (p.tags || {}).name)); });

  // Overture's own duplicates: the same name within 150 m, keep the most confident
  const kept = [];
  for (const c of [...candidates].sort((a, b) => (b.conf || 0) - (a.conf || 0))) {
    if (!CATS.includes(c.cat)) continue;
    if (c.cat === "grooming" && catOnly(c.name)) { drop("cats only"); continue; }
    if (inOsm(c)) { log.inOsm++; continue; }
    if (kept.some((k) => foldName(k.name) === foldName(c.name) && metres(k, c) < SAME_PLACE_M)) { log.duplicate++; continue; }
    kept.push(c);
  }
  const sites = check ? await checkAll(kept.filter((c) => c.site).map((c) => ({ id: c.id, site: c.site, cat: c.cat })), check) : new Map();

  const entries = [];
  for (const c of kept) {
    const id = "o-" + c.id, before = prev.get(id);
    const e = {
      id, cat: c.cat, name: c.name, street: tidyStreet(c.street), postcode: c.postcode, city: tidyCity(c.city),
      lat: c.lat, lon: c.lon, phone: c.phone, site: c.site, conf: c.conf, src: c.src,
      siteOk: before && before.siteOk, since: (before && before.since) || today
    };
    const confident = (c.conf || 0) >= MIN_CONFIDENCE;
    const recent = e.siteOk && days(today, e.siteOk) <= KEEP_DAYS;
    let keep = false;
    if (!c.site) { keep = confident; if (keep) log.byConfidence++; else drop("no website, low confidence"); }
    else if (!check) { keep = recent || (!!before && confident); if (!keep) drop("website not checked this run"); }
    else {
      const v = sites.get(c.id);
      if (v === "ok") { e.siteOk = today; keep = true; log.bySite++; }
      else if (v === "robots") { keep = confident; if (keep) log.byConfidence++; else drop("robots.txt, low confidence"); }
      else if (recent) { keep = true; log.keptUnreachable++; }
      else drop("website " + v);
    }
    if (!keep) continue;
    if (!before) log.added++;
    entries.push(e);
  }
  const now = new Set(entries.map((e) => e.id));
  for (const id of prev.keys()) if (!now.has(id)) log.removed++;
  return { entries, log };
}

/** The published place for a register entry (tools/build-places.js assemble). */
function placeOf(e) {
  const tags = Object.assign({ name: e.name }, CAT_TAGS[e.cat]);
  if (e.street) tags["addr:street"] = e.street;
  if (e.postcode) tags["addr:postcode"] = e.postcode;
  if (e.city) tags["addr:city"] = e.city;
  if (e.phone) tags.phone = e.phone;
  if (e.site) tags.website = e.site;
  tags["snuffel:source"] = "overture";
  tags["snuffel:checked"] = e.siteOk || e.since;
  return { id: e.id, lat: e.lat, lon: e.lon, tags };
}

function checkFile(cc, dir) {
  const problems = [];
  let n = 0, last = "";
  for (const line of fs.readFileSync(file(cc, dir), "utf8").split("\n")) {
    if (!line.trim()) continue;
    n++;
    let e;
    try { e = JSON.parse(line); } catch (err) { problems.push(`line ${n}: not JSON`); continue; }
    const where = `${cc} ${e.id || "line " + n}`;
    if (!/^o-[0-9a-z-]{8,}$/i.test(e.id || "")) problems.push(`${where}: bad id`);
    if (e.id <= last) problems.push(`${where}: not sorted or a duplicate`);
    last = e.id;
    if (!CATS.includes(e.cat)) problems.push(`${where}: unknown category ${e.cat}`);
    if (!e.name) problems.push(`${where}: no name`);
    if (!(Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180)) problems.push(`${where}: bad position`);
    if (!DATE.test(e.since || "")) problems.push(`${where}: bad since`);
    if (e.siteOk && !DATE.test(e.siteOk)) problems.push(`${where}: bad siteOk`);
    if (!e.siteOk && !((e.conf || 0) >= MIN_CONFIDENCE)) problems.push(`${where}: neither a confirmed website nor enough confidence`);
    for (const k of Object.keys(e)) if (!ORDER.includes(k)) problems.push(`${where}: unknown field ${k}`);
  }
  return problems;
}
const countries = (dir) => (fs.existsSync(dir || DIR) ? fs.readdirSync(dir || DIR).filter((f) => /^[a-z]{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 2)) : []);

module.exports = { merge, placeOf, read, write, checkFile, countries, checkSite, pageVerdict, tidyCity, tidyStreet, catOnly, shareWord, MIN_CONFIDENCE, KEEP_DAYS };

if (require.main === module) {
  const [cmd, cc, flag] = process.argv.slice(2);
  (async () => {
    if (cmd === "update" && /^[a-z]{2}$/.test(cc || "")) {
      const cand = path.join(CACHE, `overture-${cc}.jsonl`);
      if (!fs.existsSync(cand)) { console.log(`${cc}: no Overture candidates this run (tools/overture.py failed or was skipped): register unchanged`); return; }
      const candidates = fs.readFileSync(cand, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
      const osm = JSON.parse(fs.readFileSync(path.join(DIST, "stage", cc + ".json"), "utf8"));
      const prev = read(cc);
      const today = new Date().toISOString().slice(0, 10);
      const { entries, log } = await merge({ candidates, osm, prev, today, check: flag === "--no-sites" ? null : checkSite });
      write(cc, entries);
      console.log(`${cc}: Overture places: ${entries.length} published (${log.added} new, ${log.removed} removed) of ${log.candidates} candidates; ` +
        `already in OSM ${log.inOsm}, duplicates ${log.duplicate}; website confirmed ${log.bySite}, confidence ${log.byConfidence}, ` +
        `website unreachable but confirmed earlier ${log.keptUnreachable}; left out: ${JSON.stringify(log.dropped)}`);
    } else if (cmd === "check") {
      const problems = countries().flatMap((c) => checkFile(c));
      if (problems.length) { problems.slice(0, 50).forEach((p) => console.error(p)); console.error(`${problems.length} problem(s)`); process.exit(1); }
      console.log(`overture register ok: ${countries().join(" ") || "(none)"}`);
    } else if (cmd === "summary") {
      for (const c of countries()) {
        const all = [...read(c).values()], byCat = {};
        for (const e of all) byCat[e.cat] = (byCat[e.cat] || 0) + 1;
        console.log(`${c}: ${all.length} places from Overture ${JSON.stringify(byCat)}, ${all.filter((e) => e.siteOk).length} with a confirmed website`);
      }
    } else { console.error("usage: overture.js update <cc> [--no-sites] | check | summary"); process.exit(2); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
