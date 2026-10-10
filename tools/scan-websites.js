#!/usr/bin/env node
/* ============================================================================
 * Snuffel — vet website ownership scan
 *
 * Finds chain-owned clinics that no official list exposes (IVC Evidensia NL has
 * ~325 clinics but publishes no list; evidensia.de/.pl forbid crawling). For each
 * vet in OpenStreetMap that has a website, it loads that clinic's OWN homepage
 * (and, if needed, its legal/imprint page) and looks for ownership evidence.
 *
 * Verdicts are deliberately conservative - independents often REFER to AniCura
 * or Evidensia hospitals, so a mere mention proves nothing:
 *   confirmed - the site redirects to a group domain, or says it is part of a
 *               group ("onderdeel van", "Teil von", "fait partie"...), or names
 *               a group in its copyright line / legal entity (GmbH, B.V., ...)
 *   possible  - the group is mentioned or linked, nothing more -> human review
 *   none      - no signal found        error - site unreachable
 * Only "confirmed" feeds the app (via tools/build-chains.js). "possible" rows are
 * for a person to check and record in tools/chain-overrides.json.
 *
 * Usage:  node tools/scan-websites.js nl          (one country per run)
 * Polite: honours robots.txt, one request per host at a time, 6 hosts in parallel.
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { hostOf, groupForHost, allValues } = require("../lib/chains.js");

const COUNTRY = (process.argv[2] || "nl").toLowerCase();
const UA = "Mozilla/5.0 (compatible; SnuffelBot/1.0; dog-services directory, chain ownership check)";
// overpass-api.de answers 406 to some bot-style user agents; this one is accepted.
const OVERPASS_UA = "Snuffel-data/1.0 (dog services directory)";
const CONCURRENCY = 6;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 1500000;
const OUT = path.join(__dirname, `scan-${COUNTRY}.json`);
const CACHE = path.join(__dirname, ".cache", `osm-vets-${COUNTRY}.json`);

const GROUP = "(anicura|ivc\\s*evidensia|evidensia|caressa)";
// The group must follow the phrase within 3 words ("onderdeel van de AniCura
// familie", "fait partie du réseau Evidensia"). A loose gap misreads sentences like
// "aangesloten bij de wachtgroep van Mechelen en werkt samen met Anicura" -
// i.e. on a local on-call rota and *cooperating with* AniCura, not owned by it.
const MEMBERSHIP = new RegExp(
  "(onderdeel van|deel van|maakt deel uit van|aangesloten bij|part of|member of|belongs to|" +
  "teil (?:von|der|des)|geh[öo]rt zu|mitglied (?:der|von)|ein unternehmen der|" +
  "fait partie|membre d[ue]|nale[żz]y do|cz[eę][śs][cć]i[aą]?|sou[čc][áa]st[íi]|pat[řr][íi] do)" +
  "(?:\\s+[^\\s<>.,;:]+){0,3}?\\s+" + GROUP, "i");
// Clinics owned by a group link to the GROUP's own terms / privacy pages.
// Independents only ever link to a group's hospital pages (referrals).
const GROUP_LEGAL_LINK = /href="https?:\/\/(?:www\.)?((?:ivc)?evidensia|anicura|caressa)\.[a-z.]+\/[^"]*(algemene-voorwaarden|voorwaarden|privacy|avg|tcg|conditions-generales|mentions-legales|terms|datenschutz|impressum|agb|regulamin|polityka-prywatnosci|ochrana-osobnich-udaju)[^"]*"/i;
const FAMILY = new RegExp(GROUP + "[\\s-]*(familie|family|gruppe|groep|group|netwerk|network|r[ée]seau|grupa|skupina)", "i");
const COPYRIGHT = new RegExp("(©|&copy;|copyright)[^<>]{0,80}?" + GROUP, "i");
const LEGAL = new RegExp(GROUP + "[^<>]{0,40}?\\b(gmbh|b\\.?v\\.?|n\\.?v\\.?|sas|sarl|s\\.a\\.?|sp\\.? z o\\.?o\\.?|s\\.r\\.o\\.?|ab)\\b", "i");
const MENTION = new RegExp(GROUP, "i");
const LEGAL_LINK = /href="([^"]*(?:impressum|imprint|mentions-l[eé]gales|mentions_legales|colofon|disclaimer|o-nas|kontakt)[^"]*)"/i;

const ISO = { nl: "NL", be: "BE", fr: "FR", de: "DE", pl: "PL", cz: "CZ" };
// [south, west, north, east] - only used when a country-wide query times out.
const BBOX = {
  nl: [50.7, 3.3, 53.6, 7.3], be: [49.4, 2.5, 51.6, 6.5], fr: [41.3, -5.2, 51.2, 9.6],
  de: [47.2, 5.8, 55.1, 15.1], pl: [49.0, 14.1, 54.9, 24.2], cz: [48.5, 12.0, 51.1, 18.9]
};

async function overpassQuery(q, attempts) {
  for (let a = 1; ; a++) {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", headers: { "User-Agent": OVERPASS_UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q)
    });
    if (r.ok) return (await r.json()).elements || [];
    if (a >= (attempts || 1)) throw new Error("Overpass " + r.status);
    await new Promise((res) => setTimeout(res, 15000 * a));
  }
}

function normGroup(s) {
  s = s.toLowerCase();
  return s.indexOf("anicura") > -1 ? "AniCura" : "Evidensia";   // caressa = Evidensia
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: ctrl.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: r.ok, status: r.status, finalUrl: r.url, html: buf.subarray(0, MAX_BYTES).toString("utf8") };
  } finally { clearTimeout(timer); }
}

async function robotsAllows(origin) {
  try {
    const { ok, html } = await fetchText(origin + "/robots.txt");
    if (!ok) return true;
    let applies = false;
    for (const raw of html.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      if (m[1].toLowerCase() === "user-agent") applies = m[2].trim() === "*" || /snuffel/i.test(m[2]);
      else if (applies && m[1].toLowerCase() === "disallow" && m[2].trim() === "/") return false;
    }
    return true;
  } catch (e) { return true; }
}

function analyse(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  for (const [re, kind] of [[MEMBERSHIP, "membership statement"], [FAMILY, "group family/network wording"],
                            [COPYRIGHT, "copyright line"], [LEGAL, "legal entity"]]) {
    const m = text.match(re);
    if (m) return { verdict: "confirmed", group: normGroup(m[0].match(MENTION)[0]), evidence: kind + ': "' + m[0].trim().slice(0, 140) + '"' };
  }
  const legalLink = html.match(GROUP_LEGAL_LINK);
  if (legalLink) {
    return { verdict: "confirmed", group: normGroup(legalLink[1]), evidence: "links to the group's own legal page: " + legalLink[0].slice(6, 100) };
  }
  const link = html.match(/href="https?:\/\/(?:www\.)?((?:ivc)?evidensia|anicura|caressa)\.[a-z.]+[^"]*"/i);
  const mention = text.match(new RegExp("[^.]{0,60}" + GROUP + "[^.]{0,60}", "i"));
  if (link || mention) {
    const g = normGroup((link && link[1]) || mention[1]);
    return { verdict: "possible", group: g, evidence: link ? "links to " + link[0].slice(6, 90) : 'mentions: "' + mention[0].trim().slice(0, 140) + '"' };
  }
  return { verdict: "none" };
}

async function scanHost(host, url) {
  const origin = new URL(url).origin;
  if (!(await robotsAllows(origin))) return { verdict: "skipped", evidence: "robots.txt disallows" };
  const page = await fetchText(url);
  const finalHost = hostOf(page.finalUrl);
  const redirected = finalHost && groupForHost(finalHost);
  if (redirected) return { verdict: "confirmed", group: redirected, evidence: "redirects to " + page.finalUrl };
  if (!page.ok) return { verdict: "error", evidence: "HTTP " + page.status };
  let result = analyse(page.html);
  if (result.verdict !== "confirmed") {
    // Legal pages (Impressum in DE is mandatory and names the operating company).
    const legal = page.html.match(LEGAL_LINK);
    if (legal) {
      try {
        const legalUrl = new URL(legal[1].replace(/&amp;/g, "&"), page.finalUrl).href;
        if (hostOf(legalUrl) === finalHost) {
          const lp = await fetchText(legalUrl);
          const lr = lp.ok ? analyse(lp.html) : { verdict: "none" };
          if (lr.verdict === "confirmed" || (lr.verdict === "possible" && result.verdict === "none")) {
            result = Object.assign(lr, { evidence: lr.evidence + " (on " + legalUrl + ")" });
          }
        }
      } catch (e) { /* keep homepage result */ }
    }
  }
  return result;
}

async function osmVets() {
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 7 * 864e5) {
    return JSON.parse(fs.readFileSync(CACHE, "utf8").replace(/^﻿/, ""));
  }
  let els;
  try {
    els = await overpassQuery(`[out:json][timeout:120];area["ISO3166-1"="${ISO[COUNTRY]}"][admin_level=2]->.a;` +
                              `nwr["amenity"="veterinary"](area.a);out tags center;`);
  } catch (e) {
    // Big countries (DE, FR) can 504 as one query: retry as a grid of bbox tiles.
    // Tiles overlap the borders a little; neighbours' vets are harmless extras.
    console.log(`  country-wide query failed (${e.message}); retrying in tiles`);
    const [s, w, n, ea] = BBOX[COUNTRY], rows = 3, cols = 3, seen = new Map();
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const b = [s + (n - s) * i / rows, w + (ea - w) * j / cols, s + (n - s) * (i + 1) / rows, w + (ea - w) * (j + 1) / cols]
        .map((x) => x.toFixed(3)).join(",");
      const part = await overpassQuery(`[out:json][timeout:120];nwr["amenity"="veterinary"](${b});out tags center;`, 3);
      part.forEach((el) => seen.set(el.type + el.id, el));
      await new Promise((r) => setTimeout(r, 5000));   // be gentle between tiles
    }
    els = [...seen.values()];
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(els));
  return els;
}

module.exports = { analyse };
if (require.main === module) (async () => {
  if (!ISO[COUNTRY]) throw new Error("country must be one of " + Object.keys(ISO).join(", "));
  const vets = await osmVets();

  // One scan per website host; remember which OSM vets use it.
  const byHost = new Map();
  for (const v of vets) {
    const t = v.tags || {};
    const url = allValues(t.website || t["contact:website"] || t.url)[0];
    const host = hostOf(url);
    if (!host || groupForHost(host)) continue;   // group domains are detected directly
    const full = /^https?:\/\//i.test(url) ? url : "https://" + url;
    if (!byHost.has(host)) byHost.set(host, { host, url: full, osmIds: [], names: [] });
    const e = byHost.get(host);
    e.osmIds.push(v.type.charAt(0) + v.id);
    if (t.name) e.names.push(t.name);
  }
  const queue = [...byHost.values()];
  console.log(`${COUNTRY.toUpperCase()}: ${vets.length} vets in OSM, ${queue.length} distinct websites to check`);

  const results = [];
  let done = 0;
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      let r;
      try { r = await scanHost(item.host, item.url); }
      catch (e) { r = { verdict: "error", evidence: String(e.name === "AbortError" ? "timeout" : e.message).slice(0, 120) }; }
      results.push(Object.assign({}, item, r));
      if (++done % 25 === 0) process.stdout.write(`  ${done}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const order = { confirmed: 0, possible: 1, none: 2, skipped: 3, error: 4 };
  results.sort((a, b) => order[a.verdict] - order[b.verdict] || a.host.localeCompare(b.host));
  const tally = results.reduce((m, r) => (m[r.verdict] = (m[r.verdict] || 0) + 1, m), {});
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), country: COUNTRY, tally, results }, null, 2));
  console.log(`\n${JSON.stringify(tally)}\nwrote ${path.relative(process.cwd(), OUT)}`);
  for (const r of results.filter((x) => x.verdict === "confirmed" || x.verdict === "possible")) {
    console.log(`  ${r.verdict.padEnd(9)} ${String(r.group).padEnd(9)} ${r.host.padEnd(34)} ${r.evidence}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
