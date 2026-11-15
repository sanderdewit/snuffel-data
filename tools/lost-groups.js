/*
 * Local search groups for lost and found dogs (lost/groups.json).
 *
 *   node tools/lost-groups.js check   -> validates the list (exit 1 on errors)
 *   node tools/lost-groups.js build   -> validates, then writes dist/lost-groups.json
 *                                        (published as snuffel.app/data/lost-groups.json)
 *
 * The site and the app show these under the lost-dog guide: groups of the
 * chosen country, regional ones nearest first when the location is known.
 * Links only; nothing is read from or sent to the groups.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "lost", "groups.json");
const COUNTRIES = new Set(require("./countries.json").countries.map((c) => c.cc));
const FIELDS = ["id", "name", "url", "country", "region", "lat", "lon", "radiusKm", "added", "checked"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with the list, one string each; empty when it is valid. */
function validate(data) {
  const errors = [];
  if (!data || !Array.isArray(data.groups)) return ["groups must be an array"];
  const ids = new Set(), urls = new Set();
  data.groups.forEach((g, i) => {
    const at = `groups[${i}]${g && g.id ? " (" + g.id + ")" : ""}`;
    if (!g || typeof g !== "object") { errors.push(`${at}: not an object`); return; }
    for (const k of Object.keys(g)) if (!FIELDS.includes(k)) errors.push(`${at}: unknown field ${k}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(g.id || "")) errors.push(`${at}: id must be lowercase-with-dashes`);
    else if (ids.has(g.id)) errors.push(`${at}: duplicate id`);
    ids.add(g.id);
    if (typeof g.name !== "string" || !g.name.trim() || g.name.length > 80) errors.push(`${at}: name is required (max 80 characters)`);
    let url = null;
    try { url = new URL(g.url); } catch { /* below */ }
    if (!url || url.protocol !== "https:") errors.push(`${at}: url must be an https link`);
    else if (urls.has(url.href)) errors.push(`${at}: duplicate url`);
    if (url) urls.add(url.href);
    if (!COUNTRIES.has(String(g.country || "").toLowerCase()) || g.country !== String(g.country).toUpperCase()) {
      errors.push(`${at}: country must be an upper-case code from tools/countries.json`);
    }
    if (g.region != null && (typeof g.region !== "string" || !g.region.trim() || g.region.length > 60)) errors.push(`${at}: region must be a short text`);
    const area = [g.lat, g.lon, g.radiusKm].filter((v) => v != null).length;
    if (area !== 0 && area !== 3) errors.push(`${at}: lat, lon and radiusKm go together`);
    if (area === 3) {
      if (!(g.lat >= 34 && g.lat <= 72)) errors.push(`${at}: lat out of range (Europe)`);
      if (!(g.lon >= -32 && g.lon <= 45)) errors.push(`${at}: lon out of range (Europe)`);
      if (!(g.radiusKm >= 1 && g.radiusKm <= 500)) errors.push(`${at}: radiusKm must be 1-500`);
    }
    for (const k of ["added", "checked"]) if (!DATE.test(g[k] || "") || isNaN(Date.parse(g[k]))) errors.push(`${at}: ${k} must be YYYY-MM-DD`);
  });
  return errors;
}

/** What is published: the groups only, sorted by country, region, name. */
function build(data) {
  const groups = data.groups.map((g) => {
    const out = {};
    for (const k of FIELDS) if (g[k] != null) out[k] = g[k];
    return out;
  }).sort((a, b) => (a.country + (a.region || "") + a.name).localeCompare(b.country + (b.region || "") + b.name));
  return { version: 1, groups };
}

if (require.main === module) {
  const cmd = process.argv[2];
  const data = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const errors = validate(data);
  for (const e of errors) console.error("  " + e);
  if (errors.length) { console.error(`lost/groups.json: ${errors.length} problem(s)`); process.exit(1); }
  if (cmd === "build") {
    fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "dist", "lost-groups.json"), JSON.stringify(build(data)));
  } else if (cmd !== "check") {
    console.error("usage: node tools/lost-groups.js check|build");
    process.exit(2);
  }
  console.log(`lost/groups.json: ${data.groups.length} group(s) ok`);
}

module.exports = { validate, build };
