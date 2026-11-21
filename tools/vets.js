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
 *   node tools/vets.js check         validate vets/*.jsonl and vets/overrides.json
 *
 * One line per vet, sorted by id. Fields (only id and seen are always there):
 *   id             OSM element (n123, w456); was: earlier ids of the same clinic
 *   name, street, postcode, city, lat, lon
 *   phones         last 9 digits of each number, to find branches
 *   site           website; siteFrom "manual" | "osm" | "branch:<id>" (a branch of the
 *                  same practice: same phone number, a shared name, nearby)
 *   hours          opening hours, OpenStreetMap syntax; hoursFrom "manual" | "osm" |
 *                  "structured" | "ai" (the last two: read from the clinic's website,
 *                  with hoursUrl, hoursHash, hoursChecked)
 *   emergency      "24/7" | "on_call" from the clinic's website (emergencyPhone,
 *                  emergencyChecked), hospital: the name says animal hospital
 *   seen           last run the vet was in OpenStreetMap; gone: first run it wasn't
 *                  (kept GONE_DAYS for a clinic that comes back under a new id)
 *
 * Order of trust: a hand fix, then OpenStreetMap's own value, then the clinic's
 * own website, then a branch. Nothing is written back to OpenStreetMap.
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
  "emergency", "emergencyPhone", "emergencyChecked", "hospital", "seen", "gone"];

// ---- small helpers ---------------------------------------------------------------
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
const round = (x) => Math.round(x * 1e6) / 1e6;
function km(a, b) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}
/** The last 9 digits: the same number written as +31 30 662 0025, 030-6620025 or 0031306620025. */
function phoneKey(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}
const siteKey = (u) => String(u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/#?]+$/, "");
const website = (t) => allValues(t.website || t["contact:website"] || t.url)[0] || null;

// Words that say what a place is, not which practice it is (all languages in use).
const GENERIC = new Set(("dierenarts dierenartsen dierenartspraktijk dierenartsenpraktijk dierenkliniek dierenklinieken " +
  "dierenziekenhuis dierenartsencentrum dierenartsenpraktijken praktijk kliniek dieren dier centrum medisch " +
  "veterinair veterinaire veterinaires veterinaria veterinario veterinari veterinary vet vets clinic clinique " +
  "clinica hospital hopital ospedale animal animals animaux huisdieren practice surgery centre center group groupe " +
  "tierarzt tierarztpraxis tierarztin tierklinik tierarzte praxis kleintierpraxis kleintiere cabinet " +
  "and und und the van het den der des dei del les une voor pour per dr drs dvm").split(" "));
function nameTokens(name) {
  return foldName(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC.has(t));
}
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
 * Returns the new register and a tally of what changed.
 */
function refresh(reg, vets, fixes, today) {
  const out = new Map(), tally = { vets: vets.length, new: 0, moved: 0, gone: 0, dropped: 0, branchSites: 0, manual: 0 };
  const present = new Set(vets.map((v) => v.type.charAt(0) + v.id));
  // entries whose OSM id disappeared this run: maybe the same clinic under a new id
  const orphans = [...reg.values()].filter((e) => !present.has(e.id));
  for (const v of vets) {
    const id = v.type.charAt(0) + v.id, t = v.tags || {};
    let e = reg.get(id);
    if (!e) {
      const here = { lat: v.lat, lon: v.lon }, phones = new Set([t.phone, t["contact:phone"]].flatMap(allValues).map(phoneKey).filter(Boolean));
      const hit = orphans.find((o) => !o.taken && km(here, o) * 1000 <= MOVED_M &&
        (sameName(o.name, t.name) || (o.phones || []).some((p) => phones.has(p))));
      if (hit) { hit.taken = true; e = { ...hit, id, was: [...new Set([...(hit.was || []), hit.id])] }; delete e.taken; tally.moved++; }
      else { e = { id }; tally.new++; }
    } else e = { ...e };
    // OpenStreetMap's own facts, as they are now
    e.name = t.name || undefined;
    e.street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || undefined;
    e.postcode = t["addr:postcode"] || undefined;
    e.city = t["addr:city"] || undefined;
    e.lat = round(v.lat); e.lon = round(v.lon);
    e.phones = [...new Set([t.phone, t["contact:phone"], t["contact:mobile"]].flatMap(allValues).map(phoneKey).filter(Boolean))];
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
    e.seen = today;
    out.set(id, e);
  }
  for (const o of orphans) {
    if (o.taken) continue;
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
    const own = new Set([e.id]);
    const branches = [...new Set((e.phones || []).flatMap((p) => byPhone.get(p) || []))]
      .filter((b) => !own.has(b.id) && b.site && (b.siteFrom === "osm" || b.siteFrom === "manual") && sameName(b.name, e.name) && km(e, b) <= BRANCH_KM);
    const sites = new Set(branches.map((b) => siteKey(b.site)));
    if (sites.size === 1) {
      const b = branches.sort((x, y) => km(e, x) - km(e, y))[0];
      e.site = b.site; e.siteFrom = "branch:" + b.id; n++;
    } else if (String(e.siteFrom || "").startsWith("branch:")) { delete e.site; delete e.siteFrom; }
  }
  return n;
}

/**
 * After the website scan: tools/hours-<cc>.json ({places: {id: result}, failed: {id: status}}).
 * A result with hours replaces the website hours; a failed or empty scan keeps them.
 * Then website facts without a confirmation for KEEP_DAYS expire.
 */
function takeHours(reg, scan, today) {
  const tally = { updated: 0, confirmed: 0, kept: 0, expired: 0 };
  for (const e of reg.values()) {
    const r = (scan.places || {})[e.id];
    const manualOrOsm = e.hoursFrom === "manual" || e.hoursFrom === "osm";
    if (r) {
      if (r.opening_hours && !manualOrOsm) {
        if (e.hours === r.opening_hours) tally.confirmed++; else tally.updated++;
        Object.assign(e, { hours: r.opening_hours, hoursFrom: r.source || "ai", hoursUrl: r.url || e.site, hoursHash: r.hash, hoursChecked: r.checked || today });
      } else if (!manualOrOsm && e.hours) tally.kept++;
      if (r.emergency) Object.assign(e, { emergency: r.emergency, emergencyPhone: r.emergency_phone || undefined, emergencyChecked: r.checked || today, hospital: r.hospital || undefined });
    } else if (fromWebsite(e)) tally.kept++;
    if (fromWebsite(e) && (!e.hoursChecked || days(today, e.hoursChecked) > KEEP_DAYS)) { clear(e, WEB_HOURS); tally.expired++; }
    if (e.emergency && (!e.emergencyChecked || days(today, e.emergencyChecked) > KEEP_DAYS)) clear(e, WEB_EMERGENCY);
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
  const f = {};
  if (!e) return f;
  if (e.site && e.siteFrom !== "osm" && !website(osmTags || {})) f["snuffel:website"] = e.site;
  if (e.hours && e.hoursFrom !== "osm" && !(osmTags || {}).opening_hours) f["snuffel:opening_hours"] = e.hours;
  if (e.emergency) f["snuffel:emergency"] = e.emergency;
  if (e.emergency && e.emergencyPhone) f["snuffel:emergency_phone"] = e.emergencyPhone;
  if (f["snuffel:opening_hours"] || f["snuffel:emergency"]) f["snuffel:checked"] = e.hoursChecked || e.emergencyChecked;
  return f;
}

function check(dir = DIR) {
  const { validHours } = require("./scan-hours.js");
  const problems = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.jsonl$/.test(f)) : [];
  for (const f of files) {
    let prev = "";
    fs.readFileSync(path.join(dir, f), "utf8").split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      let e;
      try { e = JSON.parse(line); } catch (err) { problems.push(`${f}:${i + 1} invalid JSON`); return; }
      if (!/^[nwr]\d+$/.test(e.id || "")) problems.push(`${f}:${i + 1} bad id`);
      if (e.id <= prev) problems.push(`${f}:${i + 1} not sorted or duplicate (${e.id})`);
      prev = e.id;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.seen || "")) problems.push(`${f}:${i + 1} ${e.id} without seen date`);
      if (e.hours && e.hoursFrom !== "osm" && !validHours(e.hours)) problems.push(`${f}:${i + 1} ${e.id} hours not valid: ${e.hours}`);
      if (e.site && !e.siteFrom) problems.push(`${f}:${i + 1} ${e.id} site without siteFrom`);
    });
  }
  const fixes = overrides(dir);
  for (const [id, x] of Object.entries(fixes)) {
    if (!/^[nwr]\d+$/.test(id)) problems.push(`overrides.json: bad id ${id}`);
    if (x.hours && !validHours(x.hours)) problems.push(`overrides.json: ${id} hours not valid: ${x.hours}`);
    if (x.hours && !/^\d{4}-\d{2}-\d{2}$/.test(x.checked || "")) problems.push(`overrides.json: ${id} hours need a checked date`);
    if (!x.note) problems.push(`overrides.json: ${id} needs a note (who checked what, how)`);
  }
  return { files: files.length, problems };
}

module.exports = { phoneKey, siteKey, nameTokens, sameName, refresh, linkBranches, takeHours, previousFor, placeFields, read, write, overrides, check, KEEP_DAYS, GONE_DAYS };

if (require.main === module) {
  const [cmd, cc] = process.argv.slice(2);
  const today = process.env.SNUFFEL_TODAY || new Date().toISOString().slice(0, 10);
  if ((cmd === "update" || cmd === "hours") && !/^[a-z]{2}$/.test(cc || "")) { console.error(`usage: vets.js ${cmd} <cc>`); process.exit(2); }
  if (cmd === "update") {
    const vets = JSON.parse(fs.readFileSync(path.join(CACHE, `osm-vets-${cc}.json`), "utf8"));
    const { reg, tally } = refresh(read(cc), vets, overrides(), today);
    write(cc, reg);
    console.log(`vets/${cc}.jsonl: ${JSON.stringify(tally)}`);
  } else if (cmd === "hours") {
    const f = path.join(TOOLS, `hours-${cc}.json`);
    const reg = read(cc);
    const tally = takeHours(reg, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}, today);
    write(cc, reg);
    const n = [...reg.values()].filter((e) => !e.gone);
    console.log(`vets/${cc}.jsonl hours: ${JSON.stringify(tally)}; ${n.filter((e) => e.site).length} of ${n.length} with a website, ${n.filter((e) => e.hours).length} with opening hours`);
  } else if (cmd === "check") {
    const { files, problems } = check();
    problems.forEach((p) => console.log("  " + p));
    console.log(`${files} register file(s), ${problems.length} problem(s)`);
    if (problems.length) process.exit(1);
  } else { console.error("usage: vets.js update <cc> | hours <cc> | check"); process.exit(2); }
}
