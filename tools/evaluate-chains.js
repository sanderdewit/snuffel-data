#!/usr/bin/env node
/* ============================================================================
 * Snuffel — chain detection report
 * How many OSM vets in a country are flagged as AniCura / Evidensia, and by
 * which signal. Lists every flag that name matching alone would have missed,
 * so a person can sanity-check them before they go live.
 *
 * Usage:  node tools/evaluate-chains.js nl      (needs tools/.cache/osm-vets-nl.json,
 *                                                 created by tools/scan-websites.js)
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { detect } = require("../lib/chains.js");

const cc = (process.argv[2] || "nl").toLowerCase();
const vets = JSON.parse(fs.readFileSync(path.join(__dirname, ".cache", `osm-vets-${cc}.json`), "utf8").replace(/^﻿/, ""));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist", "chains.json"), "utf8"));

const byVia = {}, byGroup = {}, gained = [];
for (const v of vets) {
  const id = v.type.charAt(0) + v.id;
  const r = detect(v.tags, ref, id);
  if (!r || !r.group) continue;
  byVia[r.via] = (byVia[r.via] || 0) + 1;
  byGroup[r.group] = (byGroup[r.group] || 0) + 1;
  const nameOnly = detect({ name: v.tags.name, brand: v.tags.brand, operator: v.tags.operator }, null, null);
  if (!nameOnly) gained.push({ id, via: r.via, group: r.group, name: v.tags.name || "(unnamed)", city: v.tags["addr:city"] || "", phone: v.tags.phone || "", website: v.tags.website || "" });
}
const total = Object.values(byGroup).reduce((a, b) => a + b, 0);
const nameOnlyCount = total - gained.length;

console.log(`${cc.toUpperCase()}: ${vets.length} vets in OSM`);
console.log(`  flagged as chain:            ${total}  (${(100 * total / vets.length).toFixed(1)}%)`);
console.log(`  ...by name/brand tags only:  ${nameOnlyCount}   <- what the app could see before`);
console.log(`  ...newly found:              ${gained.length}`);
console.log(`  by signal: ${JSON.stringify(byVia)}   by group: ${JSON.stringify(byGroup)}`);
console.log(`\nNewly flagged (check these):`);
gained.sort((a, b) => a.via.localeCompare(b.via) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
  .forEach((g) => console.log(`  ${g.via.padEnd(8)} ${g.group.padEnd(9)} ${g.name.slice(0, 44).padEnd(44)} ${g.city.slice(0, 16).padEnd(16)} ${g.id}`));
