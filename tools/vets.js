#!/usr/bin/env node
/* ============================================================================
 * Snuffel — our own register of vets: websites and opening hours
 *
 * vets/<cc>.jsonl keeps, for every vet in OpenStreetMap, what we know about its
 * website and opening hours, and where each fact came from. Unlike the monthly
 * scan files it remembers: a clinic site that can't be read one month keeps the
 * hours it had; a value changes only when a source says something else, and
 * hours read from a website expire when no scan has confirmed them for
 * KEEP_DAYS. The monthly data run commits the file, so git shows every change.
 *
 *   node tools/vets.js update <cc>   before the website scan: refresh from this run's
 *                                    OpenStreetMap vets (tools/.cache/osm-vets-<cc>.json),
 *                                    the hand fixes (vets/overrides.json) and branches
 *   node tools/vets.js hours <cc>    after the scan: take in tools/hours-<cc>.json
 *                                    (no file: nothing confirmed, so only expiry)
 *   node tools/vets.js check         validate vets/*.jsonl and vets/overrides.json
 *   node tools/vets.js summary       one line per country: vets, websites, hours by source
 *
 * One line per vet, sorted by id. Fields (only id and since are always there):
 *   id             OSM element (n123, w456); was: earlier ids of the same clinic
 *   name, street, postcode, city, lat, lon
 *   phones         last 9 digits of each number, to find branches
 *   site           website; siteFrom "manual" | "osm" | "branch:<id>" (a branch of the
 *                  same practice: same phone number, a shared name, nearby)
 *   hours          opening hours, OpenStreetMap syntax; hoursFrom "manual" | "osm" |
 *                  "structured" | "ai" (the last two: read from the clinic's website,
 *                  with hoursUrl, hoursHash, hoursChecked; manual: hoursChecked)
 *   emergency      "24/7" | "on_call" from the clinic's website (emergencyPhone,
 *                  emergencyChecked), hospital: the name says animal hospital
 *   since          first run the vet was in the register; gone: first run it wasn't in
 *                  OpenStreetMap (kept GONE_DAYS for a clinic that comes back under a new
 *                  id). No "last seen" date: it would change every line every month.
 *
 * Order of trust: a hand fix, then OpenStreetMap's own value, then the clinic's
 * own website, then a branch. The published places never hide OSM's own website
 * or opening_hours: our values are separate "snuffel:" fields that the site and
 * app use only where OSM has none (a wrong OSM value is fixed in OSM itself).
 * Nothing is written back to OpenStreetMap.
 * Licence: derived from OpenStreetMap data (ODbL 1.0) plus facts published by the
 * clinics themselves.
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { foldName } = require("../lib/classify.js");
const { allValues } = require("../lib/chains.js");

const ROOT = path.join(__dirname, "..");
const DIR = process.env.SNUFFEL_VETS || path.join(ROOT, "vets");
const CACHE = process.env.SNUFFEL_CACHE || path.join(__dirname, ".cache");
const TOOLS = process.env.SNUFFEL_TOOLS || __dirname;
const KEEP_DAYS = 180;        // hours / emergency info read from a website, without a newer confirmation
const GONE_DAYS = 90;         // a vet no longer in OpenStreetMap
const MOVED_M = 150;          // the same clinic under a new OSM id: this close
const BRANCH_KM = 40;         // branches of one practice: this close
const ORDER = ["id", "was", "name", "street", "postcode", "city", "lat", "lon", "phones",
  "site", "siteFrom", "hours", "hoursFrom", "hoursUrl", "hoursHash", "hoursChecked",
  "emergency", "emergencyPhone", "emergencyChecked", "hospital", "since", "gone"];

// ---- small helpers ---------------------------------------------------------------
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
const round = (x) => Math.round(x * 1e6) / 1e6;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[nwr]\d+$/;
function km(a, b) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}
/** The last 9 digits: the same number written as +31 30 662 0025, 030-6620025 or 0031306620025. */
function phoneKey(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}
const phonesOf = (t) => [...new Set([t.phone, t["contact:phone"], t["contact:mobile"]].flatMap(allValues).map(phoneKey).filter(Boolean))];
const siteKey = (u) => String(u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/#?]+$/, "");
const website = (t) => allValues(t.website || t["contact:website"] || t.url)[0] || null;

// Words that say what a place is, not which practice it is, in every language Snuffel
// covers (written naturally, folded like names).
const GENERIC = new Set([
  "dierenarts dierenartsen dierenartspraktijk dierenartsenpraktijk dierenkliniek dierenklinieken dierenziekenhuis",
  "dierenartsencentrum dierenartsenpraktijken praktijk kliniek dieren dier centrum medisch huisdieren",
  "veterinair veterinaire veterinaires veterinaria veterinarie veterinario veterinari veterinary vet vets",
  "clinic clinics clinique clinica clinicas hospital hopital ospedale animal animals animaux practice surgery",
  "centre center centro group groupe gruppo grupo medical",
  "tierarzt tierärzte tierarztpraxis tierärztin tierärztliche tierärztlicher tierklinik tierarztzentrum",
  "fachtierarzt kleintierpraxis kleintierklinik kleintiere tierspital praxis cabinet",
  "ambulatorio studio medico pequeños animales animali consultorio",
  "dyrlæge dyrlæger dyrlægerne dyreklinik dyreklinikken dyrehospital dyrlege dyreklinikk dyresykehus",
  "veterinär veterinærklinikk djurklinik djurklinikken djursjukhus smådjursklinik",
  "eläinlääkäri eläinlääkäriasema eläinklinikka eläinsairaala dýralæknir dýraspítali",
  "loomakliinik veterinaarkliinik loomaarst veterinārā klīnika veterinārārsts veterinarijos",
  "przychodnia gabinet weterynaryjny weterynaryjna weterynaryjne lecznica klinika weterynarz zwierząt",
  "veterinární ordinace veterina veterinárna ambulancia állatorvos állatorvosi rendelő",
  "veterinar veterinară cabinetul",
  "ветеринарна ветеринарен ветеринарний ветеринарная ветеринарска клиника клініка ветклініка ветклиника кабинет",
  "veterinarska veterinarski veterinarske ambulanta stanica ordinacija bolnica",
  "κτηνιατρείο κτηνίατρος κτηνιατρική κτηνιατρικό κλινική klinika veterinare",
  "and und the van het den der des dei del les une voor pour per dr drs dvm mvdr"
].join(" ").split(" ").map(foldName));
// Words of a folded name in any script ("Ветеринарна клиника Зоовет": one distinctive word).
function nameTokens(name) {
  return foldName(name).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !GENERIC.has(t));
}
/** A shared distinctive word ("Mark" in "Mark dierenarts" / "Mark Dierenarts"); names of only generic words must match whole. */
function sameName(a, b) {
  const ta = nameTokens(a), tb = new Set(nameTokens(b));
  if (!ta.length || !tb.size) return foldName(a).trim() !== "" && foldName(a).trim() === foldName(b).trim();
  return ta.some((t) => tb.has(t));
}

// ---- the file --------------------------------------------------------------------
function tidy(e) {
  const out = {};
  for (const k of ORDER) if (e[k] !== undefined && e[k] !== null && !(Array.isArray(e[k]) && !e[k].length)) out[k] = e[k];
  return out;
}
function read(cc, dir = DIR) {
  const f = path.join(dir, cc + ".jsonl");
  const out = new Map();
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) if (line.trim()) { const e = JSON.parse(line); out.set(e.id, e); }
  return out;
}
function write(cc, reg, dir = DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [...reg.values()].map(tidy).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => JSON.stringify(e));
  fs.writeFileSync(path.join(dir, cc + ".jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
}
function overrides(dir = DIR) {
  const f = path.join(dir, "overrides.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).vets || {} : {};
}
const WEB_HOURS = ["hours", "hoursFrom", "hoursUrl", "hoursHash", "hoursChecked"];
const WEB_EMERGENCY = ["emergency", "emergencyPhone", "emergencyChecked", "hospital"];
const clear = (e, keys) => keys.forEach((k) => delete e[k]);
const fromWebsite = (e) => e.hoursFrom === "structured" || e.hoursFrom === "ai";

/**
 * Before the website scan: the register brought in line with this run's OpenStreetMap
 * vets (tools/.cache/osm-vets-<cc>.json, objects {type, id, lat, lon, tags}).
 * Returns the new register and a tally of what changed; `reg` itself is not changed.
 */
function refresh(reg, vets, fixes, today) {
  const out = new Map(), tally = { vets: vets.length, new: 0, moved: 0, gone: 0, dropped: 0, branchSites: 0, manual: 0 };
  const present = new Set(vets.map((v) => v.type.charAt(0) + v.id));
  // entries whose OSM id disappeared this run: maybe the same clinic under a new id
  const orphans = [...reg.values()].filter((e) => !present.has(e.id)), taken = new Set();
  for (const v of vets) {
    const id = v.type.charAt(0) + v.id, t = v.tags || {}, phones = phonesOf(t);
    let e = reg.get(id);
    if (!e) {
      const hit = orphans.find((o) => !taken.has(o.id) && km({ lat: v.lat, lon: v.lon }, o) * 1000 <= MOVED_M &&
        (sameName(o.name, t.name) || (o.phones || []).some((p) => phones.includes(p))));
      if (hit) { taken.add(hit.id); e = { ...hit, id, was: [...new Set([...(hit.was || []), hit.id])] }; tally.moved++; }
      else { e = { id }; tally.new++; }
    } else e = { ...e };
    // OpenStreetMap's own facts, as they are now
    e.name = t.name || undefined;
    e.street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || undefined;
    e.postcode = t["addr:postcode"] || undefined;
    e.city = t["addr:city"] || undefined;
    e.lat = round(v.lat); e.lon = round(v.lon);
    e.phones = phones;
    const osmSite = website(t);
    if (osmSite) { e.site = osmSite; e.siteFrom = "osm"; }
    else if (e.siteFrom === "osm") { delete e.site; delete e.siteFrom; }      // removed in OSM: a branch may fill it below
    if (t.opening_hours) { clear(e, WEB_HOURS); e.hours = t.opening_hours; e.hoursFrom = "osm"; }
    else if (e.hoursFrom === "osm") clear(e, WEB_HOURS);                    // removed in OSM: the website scan may fill it
    // hand fixes win (vets/overrides.json, by id or an earlier id); one taken out of the file no longer counts
    const fix = fixes[id] || (e.was || []).map((w) => fixes[w]).find(Boolean);
    if (e.siteFrom === "manual" && !(fix && fix.site)) { delete e.site; delete e.siteFrom; }
    if (e.hoursFrom === "manual" && !(fix && fix.hours)) clear(e, WEB_HOURS);
    if (fix) {
      if (fix.site) { e.site = fix.site; e.siteFrom = "manual"; }
      if (fix.hours) { clear(e, WEB_HOURS); e.hours = fix.hours; e.hoursFrom = "manual"; e.hoursChecked = fix.checked; }
      tally.manual++;
    }
    delete e.gone;
    e.since = e.since || today;
    out.set(id, e);
  }
  for (const o of orphans) {
    if (taken.has(o.id)) continue;
    const e = { ...o };
    e.gone = e.gone || today;
    if (days(today, e.gone) > GONE_DAYS) { tally.dropped++; continue; }
    tally.gone++;
    out.set(e.id, e);
  }
  tally.branchSites = linkBranches(out);
  return { reg: out, tally };
}

/**
 * Branches of one practice share a phone number and a name, like "Mark dierenarts"
 * in Vleuten (with a website) and in Utrecht (without). A vet without a website of
 * its own gets its branch's, but only when every such branch has the same website
 * (a group's central number with one page per clinic would otherwise pick a wrong one).
 */
function linkBranches(reg) {
  const live = [...reg.values()].filter((e) => !e.gone);
  const byPhone = new Map();
  for (const e of live) for (const p of e.phones || []) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(e); }
  let n = 0;
  for (const e of live) {
    if (e.siteFrom === "osm" || e.siteFrom === "manual") continue;
    const branches = [...new Set((e.phones || []).flatMap((p) => byPhone.get(p) || []))]
      .filter((b) => b.id !== e.id && b.site && (b.siteFrom === "osm" || b.siteFrom === "manual") && sameName(b.name, e.name) && km(e, b) <= BRANCH_KM);
    const sites = new Set(branches.map((b) => siteKey(b.site)));
    if (sites.size === 1) {
      const b = branches.sort((x, y) => km(e, x) - km(e, y))[0];
      e.site = b.site; e.siteFrom = "branch:" + b.id; n++;
    } else if (String(e.siteFrom || "").startsWith("branch:")) { delete e.site; delete e.siteFrom; }
  }
  return n;
}

/**
 * After the website scan: tools/hours-<cc>.json ({places: {id: result}}; only vets with
 * an answer are in it). A result with hours replaces the website hours; a site that
 * failed or gave nothing keeps them. Then website facts without a confirmation for
 * KEEP_DAYS expire. Hand-fixed and OSM hours are never touched here.
 */
function takeHours(reg, scan, today) {
  const { oneRulePerDay } = require("./scan-hours.js");
  const tally = { updated: 0, confirmed: 0, kept: 0, expired: 0, ambiguous: 0, emergency: 0 };
  const places = (scan && scan.places) || {};
  for (const e of reg.values()) {
    const r = places[e.id];
    const ours = !(e.hoursFrom === "manual" || e.hoursFrom === "osm");
    if (r && r.opening_hours && ours) {
      if (e.hours === r.opening_hours) tally.confirmed++; else tally.updated++;
      Object.assign(e, { hours: r.opening_hours, hoursFrom: r.source || "ai", hoursUrl: r.url || e.site, hoursHash: r.hash || undefined, hoursChecked: r.checked || today });
    } else if (e.hoursFrom === "ai" && !oneRulePerDay(e.hours)) {
      // an earlier answer with a day in two rules (tools/scan-hours.js oneRulePerDay): not kept
      clear(e, WEB_HOURS); tally.ambiguous++;
    } else if (fromWebsite(e)) {
      if (!e.hoursChecked || days(today, e.hoursChecked) > KEEP_DAYS) { clear(e, WEB_HOURS); tally.expired++; }
      else tally.kept++;
    }
    if (r && r.emergency) {
      clear(e, WEB_EMERGENCY);
      Object.assign(e, { emergency: r.emergency, emergencyPhone: r.emergency_phone || undefined, emergencyChecked: r.checked || today, hospital: r.hospital || undefined });
      tally.emergency++;
    } else if (e.emergency && (!e.emergencyChecked || days(today, e.emergencyChecked) > KEEP_DAYS)) clear(e, WEB_EMERGENCY);
  }
  return tally;
}

/** What tools/scan-hours.js passes as "previous" for a vet: the answer for an unchanged page. */
function previousFor(e) {
  if (!e || !e.hoursHash) return undefined;
  return { opening_hours: fromWebsite(e) ? e.hours : null, source: fromWebsite(e) ? e.hoursFrom : null, emergency: e.emergency || null,
    emergency_phone: e.emergencyPhone || null, hospital: !!e.hospital, url: e.hoursUrl || e.site, hash: e.hoursHash, checked: e.hoursChecked };
}

/** The "snuffel:" fields tools/build-places.js adds to a place from its register entry. */
function placeFields(e, osmTags) {
  const f = {}, t = osmTags || {};
  if (!e) return f;
  if (e.site && e.siteFrom !== "osm" && !website(t)) f["snuffel:website"] = e.site;
  if (e.hours && e.hoursFrom !== "osm" && !t.opening_hours) f["snuffel:opening_hours"] = e.hours;
  if (e.emergency) f["snuffel:emergency"] = e.emergency;
  if (e.emergency && e.emergencyPhone) f["snuffel:emergency_phone"] = e.emergencyPhone;
  const checked = f["snuffel:opening_hours"] ? e.hoursChecked || e.emergencyChecked : f["snuffel:emergency"] ? e.emergencyChecked : null;
  if (checked) f["snuffel:checked"] = checked;
  return f;
}

function check(dir = DIR) {
  const { validHours } = require("./scan-hours.js");
  const problems = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.jsonl$/.test(f)) : [];
  const url = (u) => /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(String(u || ""));
  for (const f of files) {
    let prev = "";
    fs.readFileSync(path.join(dir, f), "utf8").split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      const at = `${f}:${i + 1}`;
      let e;
      try { e = JSON.parse(line); } catch (err) { problems.push(`${at} invalid JSON`); return; }
      if (!ID.test(e.id || "")) problems.push(`${at} bad id`);
      if (e.id <= prev) problems.push(`${at} not sorted or duplicate (${e.id})`);
      prev = e.id;
      if (!DATE.test(e.since || "")) problems.push(`${at} ${e.id} without a since date`);
      if (e.gone && !DATE.test(e.gone)) problems.push(`${at} ${e.id} bad gone date`);
      if ((e.was || []).some((w) => !ID.test(w))) problems.push(`${at} ${e.id} bad earlier id`);
      if (e.site && !/^(manual|osm|branch:[nwr]\d+)$/.test(e.siteFrom || "")) problems.push(`${at} ${e.id} site without a valid siteFrom`);
      if (!e.site && e.siteFrom) problems.push(`${at} ${e.id} siteFrom without site`);
      if (e.hours && !/^(manual|osm|structured|ai)$/.test(e.hoursFrom || "")) problems.push(`${at} ${e.id} hours without a valid hoursFrom`);
      if (!e.hours && e.hoursFrom) problems.push(`${at} ${e.id} hoursFrom without hours`);
      if (e.hours && e.hoursFrom !== "osm" && !validHours(e.hours)) problems.push(`${at} ${e.id} hours not valid: ${e.hours}`);
      if (e.hours && e.hoursFrom !== "osm" && !DATE.test(e.hoursChecked || "")) problems.push(`${at} ${e.id} hours without a checked date`);
      if (e.emergency && !/^(24\/7|on_call)$/.test(e.emergency)) problems.push(`${at} ${e.id} bad emergency value`);
      if (e.emergency && !DATE.test(e.emergencyChecked || "")) problems.push(`${at} ${e.id} emergency info without a checked date`);
    });
  }
  let fixes = {};
  const of = path.join(dir, "overrides.json");
  if (fs.existsSync(of)) {
    try {
      const data = JSON.parse(fs.readFileSync(of, "utf8"));
      if (!data.vets || typeof data.vets !== "object" || Array.isArray(data.vets)) problems.push("overrides.json: needs a \"vets\" object");
      else fixes = data.vets;
    } catch (err) { problems.push("overrides.json: invalid JSON"); }
  }
  for (const [id, x] of Object.entries(fixes)) {
    if (!ID.test(id)) problems.push(`overrides.json: bad id ${id}`);
    if (!x || typeof x !== "object") { problems.push(`overrides.json: ${id} is not an object`); continue; }
    if (!x.site && !x.hours) problems.push(`overrides.json: ${id} has neither site nor hours`);
    if (x.site && !url(x.site)) problems.push(`overrides.json: ${id} site is not an http(s) address: ${x.site}`);
    if (x.hours && !validHours(x.hours)) problems.push(`overrides.json: ${id} hours not valid: ${x.hours}`);
    if (x.hours && !DATE.test(x.checked || "")) problems.push(`overrides.json: ${id} hours need a checked date`);
    if (!x.note) problems.push(`overrides.json: ${id} needs a note (who checked what, how)`);
  }
  return { files: files.length, problems };
}

/** Per country: vets, and websites / opening hours by source (for the monthly commit message). */
function summary(dir = DIR) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.jsonl$/.test(f)).sort() : [];
  return files.map((f) => {
    const all = [...read(f.slice(0, 2), dir).values()], live = all.filter((e) => !e.gone);
    // counts by source, in the order of trust
    const by = (key, kinds, kind) => {
      const c = Object.fromEntries(kinds.map((k) => [k, 0]));
      for (const e of live) if (e[key]) c[kind(e[key + "From"])]++;
      const n = Object.values(c).reduce((x, y) => x + y, 0);
      return `${n} (${kinds.filter((k) => c[k]).map((k) => `${k} ${c[k]}`).join(", ") || "none"})`;
    };
    const sites = by("site", ["manual", "osm", "branch"], (s) => (String(s).startsWith("branch:") ? "branch" : s));
    const hours = by("hours", ["manual", "osm", "website"], (s) => (s === "structured" || s === "ai" ? "website" : s));
    return `${f.slice(0, 2)}: ${live.length} vets${all.length > live.length ? ` (+${all.length - live.length} gone, kept ${GONE_DAYS} days)` : ""}; ` +
      `website ${sites}; opening hours ${hours}; ` +
      `emergency info ${live.filter((e) => e.emergency).length}`;
  });
}

module.exports = { phoneKey, siteKey, nameTokens, sameName, refresh, linkBranches, takeHours, previousFor, placeFields, read, write, overrides, check, summary, KEEP_DAYS, GONE_DAYS };

if (require.main === module) {
  const [cmd, cc] = process.argv.slice(2);
  const today = process.env.SNUFFEL_TODAY || new Date().toISOString().slice(0, 10);
  if ((cmd === "update" || cmd === "hours") && !/^[a-z]{2}$/.test(cc || "")) { console.error(`usage: vets.js ${cmd} <cc>`); process.exit(2); }
  if (cmd === "update") {
    const vets = JSON.parse(fs.readFileSync(path.join(CACHE, `osm-vets-${cc}.json`), "utf8"));
    const old = read(cc), live = [...old.values()].filter((e) => !e.gone).length;
    // a broken or truncated extract must not mark half the country as gone
    if (live >= 20 && vets.length < live / 2) {
      console.error(`vets/${cc}.jsonl: only ${vets.length} vets in this run's OpenStreetMap data against ${live} in the register - not updated`);
      process.exit(1);
    }
    const { reg, tally } = refresh(old, vets, overrides(), today);
    write(cc, reg);
    console.log(`vets/${cc}.jsonl: ${JSON.stringify(tally)}`);
  } else if (cmd === "hours") {
    const f = path.join(TOOLS, `hours-${cc}.json`);
    const reg = read(cc);
    const tally = takeHours(reg, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}, today);
    write(cc, reg);
    const n = [...reg.values()].filter((e) => !e.gone);
    console.log(`vets/${cc}.jsonl hours${fs.existsSync(f) ? "" : " (no scan this run)"}: ${JSON.stringify(tally)}; ${n.filter((e) => e.site).length} of ${n.length} with a website, ${n.filter((e) => e.hours).length} with opening hours`);
  } else if (cmd === "check") {
    const { files, problems } = check();
    problems.forEach((p) => console.log("  " + p));
    console.log(`${files} register file(s), ${problems.length} problem(s)`);
    if (problems.length) process.exit(1);
  } else if (cmd === "summary") {
    summary().forEach((l) => console.log(l));
  } else { console.error("usage: vets.js update <cc> | hours <cc> | check | summary"); process.exit(2); }
}
