#!/usr/bin/env node
/* ============================================================================
 * Snuffel — chain reference builder
 *
 * Builds dist/chains.json (published to <storage>/data/chains.json): the authoritative signals the app uses to tell
 * chain-owned vets (AniCura, Evidensia) from independents. OSM names alone miss
 * many chain clinics, because acquired practices usually keep their own name
 * ("Medisch Centrum voor Dieren" is AniCura). Phone numbers and website domains
 * published by the groups themselves don't have that problem.
 *
 * Sources (each checked against robots.txt before crawling):
 *   - AniCura country sites: every clinic page from the sitemap -> name + phones
 *   - Evidensia Belgium: the public practice list -> name + website domain
 *   - tools/chain-overrides.json: manual corrections, keyed by OSM id
 * Not crawled: evidensia.de / evidensia.pl (robots.txt disallows everything),
 * ivcevidensia.nl (publishes no clinic list).
 *
 * Usage:  node tools/build-chains.js            (≈ 4-6 minutes, 1 request/s)
 * Re-run monthly; commit the output.
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const UA = "Mozilla/5.0 (compatible; SnuffelBot/1.0; dog-services directory, chain ownership check)";
const DELAY_MS = 1000;
const OUT = path.join(__dirname, "..", "dist", "chains.json");
const OVERRIDES = path.join(__dirname, "chain-overrides.json");

const ANICURA = [
  { country: "nl", site: "https://www.anicura.nl", section: "klinieken" },
  { country: "be", site: "https://www.anicura.be", section: "klinieken" },
  { country: "de", site: "https://www.anicura.de", section: "standorte" },
  { country: "fr", site: "https://www.anicura.fr", section: "cliniques" },
  { country: "pl", site: "https://www.anicura.pl", section: "znajdz-praktyke" }
];
const EVIDENSIA_BE = "https://evidensia.be/over-evidensia/praktijken-in-belgie/";

// Hosts that are never a clinic's own website.
// Group / sister-country sites (the BE page links "Duitsland", "Ierland", ...)
// are navigation, not practices.
const NOT_A_CLINIC = /(^|\.)((ivc)?evidensia[a-z]*\.[a-z.]+|independentvetcare\.[a-z.]+|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com|google\.[a-z.]+|goo\.gl|apple\.com|tiktok\.com|cookiebot\.com|onetrust\.com)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xml" }, redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

// Minimal robots.txt check for the "*" group: is `pathname` disallowed?
async function allowedByRobots(origin, pathname) {
  let txt;
  try { txt = await get(origin + "/robots.txt"); } catch (e) { return true; }
  let applies = false;
  const disallow = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") applies = v === "*";
    else if (k === "disallow" && applies && v) disallow.push(v);
  }
  return !disallow.some((rule) => pathname.startsWith(rule));
}

// Same phone key / host normalisation the app uses to match OSM vets.
const { phoneKey, hostOf } = require("../lib/chains.js");

// Accented named entities (&eacute;, &ouml;, &ccedil;...) -> letter + combining mark.
const ACCENT = { acute: "́", grave: "̀", circ: "̂", uml: "̈", cedil: "̧", tilde: "̃", ring: "̊" };
function decode(s) {
  return s.replace(/&([a-z])(acute|grave|circ|uml|cedil|tilde|ring);/gi, (m, ch, k) => ch + ACCENT[k.toLowerCase()])
    .replace(/&amp;/g, "&").replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .normalize("NFC").trim();
}

function clinicName(html, slug) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) { const t = decode(h1[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); if (t) return t; }
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (title) return decode(title[1].split("|")[0]);
  return slug;
}

async function anicura(src, log) {
  const sitemapPath = "/sitemap.xml";
  if (!(await allowedByRobots(src.site, "/" + src.section + "/"))) {
    log.push(`${src.site}: skipped, robots.txt disallows /${src.section}/`);
    return [];
  }
  const xml = await get(src.site + sitemapPath);
  const re = new RegExp("^/" + src.section + "/([^/]+)/?$");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => re.test(new URL(u).pathname));
  const clinics = [];
  for (const url of urls) {
    await sleep(DELAY_MS);
    try {
      const html = await get(url);
      const slug = new URL(url).pathname.match(re)[1];
      const phones = [...new Set([...html.matchAll(/href="tel:([^"]+)"/gi)].map((m) => phoneKey(decodeURIComponent(m[1]))).filter(Boolean))];
      clinics.push({ group: "AniCura", country: src.country, name: clinicName(html, slug), url, phones });
      process.stdout.write(".");
    } catch (e) {
      log.push(`  ! ${url}: ${e.message}`);
    }
  }
  process.stdout.write("\n");
  log.push(`${src.site}: ${clinics.length} clinic pages, ${clinics.filter((c) => c.phones.length).length} with phone numbers`);
  return clinics;
}

async function evidensiaBelgium(log) {
  const u = new URL(EVIDENSIA_BE);
  if (!(await allowedByRobots(u.origin, u.pathname))) { log.push("evidensia.be: skipped by robots.txt"); return []; }
  const html = await get(EVIDENSIA_BE);
  // Only the page body: header/footer links are navigation, not practices.
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  const out = [];
  for (const m of main.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const host = hostOf(m[1]);
    const name = decode(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (!host || NOT_A_CLINIC.test(host) || !name) continue;
    out.push({ group: "Evidensia", country: "be", name, url: EVIDENSIA_BE, domain: host });
  }
  log.push(`evidensia.be: ${out.length} practices with their own website`);
  return out;
}

(async () => {
  const log = [];
  const clinics = [];
  for (const src of ANICURA) {
    process.stdout.write(`AniCura ${src.country} `);
    try { clinics.push(...(await anicura(src, log))); }
    catch (e) { log.push(`${src.site}: FAILED ${e.message}`); process.stdout.write("\n"); }
  }
  try { clinics.push(...(await evidensiaBelgium(log))); }
  catch (e) { log.push(`evidensia.be: FAILED ${e.message}`); }

  // Index for the app: phone key -> clinic, domain -> clinic. A phone listed by
  // two groups would be ambiguous; drop it rather than guess.
  const phones = {}, domains = {}, conflicts = new Set();
  for (const c of clinics) {
    const ref = { g: c.group, n: c.name, c: c.country };
    for (const p of c.phones || []) {
      if (phones[p] && phones[p].g !== c.group) conflicts.add(p);
      phones[p] = ref;
    }
    if (c.domain) domains[c.domain] = ref;
  }
  conflicts.forEach((p) => delete phones[p]);

  // Confirmed findings from tools/scan-websites.js (clinic sites that redirect to
  // a group domain or state they are part of one). Official lists win on conflict.
  let scanned = 0;
  const scannedCountries = new Set();
  for (const f of fs.readdirSync(__dirname).filter((n) => /^scan-[a-z]{2}\.json$/.test(n))) {
    const scan = JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
    scannedCountries.add(scan.country);
    for (const r of scan.results || []) {
      if (r.verdict !== "confirmed" || domains[r.host]) continue;
      domains[r.host] = { g: r.group, n: (r.names && r.names[0]) || r.host, c: scan.country, s: "website" };
      scanned++;
    }
  }
  if (scanned) log.push(`website scans: ${scanned} confirmed clinic domains added`);

  // Countries not scanned this run (scan skipped or failed) keep the website
  // findings from the currently published file, so a bad night never silently
  // relabels confirmed chain clinics as independent.
  const previousFile = path.join(__dirname, "..", "dist", "previous-chains.json");
  if (fs.existsSync(previousFile)) {
    let carried = 0;
    const prev = JSON.parse(fs.readFileSync(previousFile, "utf8"));
    for (const [host, ref] of Object.entries(prev.domains || {})) {
      if (ref.s !== "website" || domains[host] || scannedCountries.has(ref.c)) continue;
      domains[host] = ref;
      carried++;
    }
    if (carried) log.push(`kept ${carried} website-confirmed domains from the previous build (countries not scanned this run)`);
  }

  let overrides = {};
  try { overrides = JSON.parse(fs.readFileSync(OVERRIDES, "utf8")).overrides || {}; } catch (e) { /* none yet */ }

  const out = {
    generated: new Date().toISOString(),
    note: "Built by tools/build-chains.js from the groups' own public clinic lists. Do not edit by hand; use tools/chain-overrides.json.",
    counts: { clinics: clinics.length, phones: Object.keys(phones).length, domains: Object.keys(domains).length, overrides: Object.keys(overrides).length },
    phones, domains, overrides
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  // The detailed report is for review only - keep it out of web/ (which is published).
  fs.writeFileSync(path.join(__dirname, "chains.report.json"), JSON.stringify({ generated: out.generated, log, clinics }, null, 2));

  console.log("\n" + log.join("\n"));
  console.log(`\nwrote ${path.relative(process.cwd(), OUT)}: ${JSON.stringify(out.counts)}`);
})();
