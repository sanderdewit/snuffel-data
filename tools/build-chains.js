#!/usr/bin/env node
/* ============================================================================
 * Snuffel — chain reference builder
 *
 * Builds dist/chains.json (published to <storage>/data/chains.json): the authoritative signals the app uses to tell
 * chain-owned vets (AniCura, Evidensia, VetPartners, ...) from independents. OSM names alone miss
 * many chain clinics, because acquired practices usually keep their own name
 * ("Medisch Centrum voor Dieren" is AniCura). Phone numbers and website domains
 * published by the groups themselves don't have that problem.
 *
 * Sources (each checked against robots.txt, including its Crawl-delay):
 *   - the groups' own clinic lists (SOURCES below: AniCura in 13 countries,
 *     VetPartners, Medivet, CVS, Linnaeus, Vets for Pets, Sevetys, Mon Véto,
 *     Univet, Argos, Kivet, Tierarzt Plus Partner, Vetopia AT, VetTrust,
 *     Animalia, Ca' Zampa) -> name + phones (+ the clinic's own website)
 *   - Evidensia Belgium: the public practice list -> name + website domain
 *   - confirmed findings of tools/scan-websites.js
 *   - tools/chain-overrides.json: manual corrections, keyed by OSM id
 *
 * Usage:  node tools/build-chains.js crawl   crawl the lists (~1.5 h, polite)
 *         node tools/build-chains.js build   build dist/chains.json from the crawl
 *         node tools/build-chains.js         both
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { ruleMatches, robotsBody } = require("./robots-match.js");

const UA ="Mozilla/5.0 (compatible; SnuffelBot/1.0; dog-services directory, chain ownership check)";
const DELAY_MS = 1000;
const TIMEOUT_MS = 30000;
const OUT = path.join(__dirname, "..", "dist", "chains.json");
const OVERRIDES = path.join(__dirname, "chain-overrides.json");
// `crawl` writes the groups' clinic lists here (its own CI job, ~1.5 h because
// of robots.txt crawl delays); the build step reads it back.
const CRAWL_CACHE = path.join(__dirname, ".cache", "official-clinics.json");

// The groups' own clinic lists. Every source: one clinic per page, found in a
// sitemap or on a list page; `match` picks the clinic pages by path. From each
// page we take the clinic's phone numbers and, with `domains`, the link to the
// clinic's own website (groups that let practices keep their name and site).
// Checked 2026-10. Not crawlable: svenskavet.se and grupaluxvet.pl (pages built
// by JavaScript), unavets.com (does not answer), evidensia.de / .pl (robots.txt),
// ivcevidensia.nl (no list) - those rely on names, domains and the website scan.
const ANICURA = [
  ["nl", "nl", "klinieken"], ["be", "be", "klinieken"], ["de", "de", "standorte"], ["fr", "fr", "cliniques"],
  ["pl", "pl", "znajdz-praktyke"], ["no", "no", "klinikker"], ["se", "se", "hitta-klinik"], ["dk", "dk", "klinikker"],
  ["es", "es", "clinicas"], ["at", "at", "standorte"], ["it", "it", "cliniche"], ["ch", "ch", "standorte"],
  ["pt", "pt", "clinicas-veterinarias"]
].map(([country, tld, section]) => ({
  group: "AniCura", country, site: "https://www.anicura." + tld, sitemap: "/sitemap.xml", match: new RegExp("^/" + section + "/[^/]+/?$")
}));
const VETPARTNERS = [
  ["gb", "https://www.vetpartners.co.uk"], ["de", "https://www.vetpartnersdeutschland.de"], ["es", "https://www.vetpartners.es"],
  ["fr", "https://www.vetpartners.fr"], ["it", "https://www.vetpartnersitalia.it"], ["pt", "https://www.vetpartnersportugal.pt"],
  ["ie", "https://www.vetpartners.ie"]
].map(([country, site]) => ({ group: "VetPartners", country, site, sitemap: "/surgery-sitemap.xml", match: /^\/(surgeries|strutture)\/[^/]+\/?$/, domains: true }))
  .concat([{ group: "VetPartners", country: "nl", site: "https://www.vetpartners.nl", sitemap: "/practice-sitemap.xml", match: /^\/practices\/[^/]+\/?$/, domains: true }]);
const CVS_REGIONS = "east|east-midlands|london|north-east|north-west|northern-ireland|scotland|south-east|south-west|wales|west-midlands|yorkshire-and-humber";
const SOURCES = ANICURA.concat(VETPARTNERS, [
  { group: "Medivet", country: "gb", site: "https://www.medivetgroup.com", sitemap: "/sitemap.xml", match: /^\/vet-practices\/[^/]+\/?$/ },
  { group: "Medivet", country: "de", site: "https://www.medivetgroup.com", sitemap: "/sitemap.xml", match: /^\/de-de\/tierarzt\/[^/]+\/?$/ },
  { group: "Medivet", country: "es", site: "https://www.medivetgroup.com", sitemap: "/sitemap.xml", match: /^\/es-es\/clinicas-veterinarias\/[^/]+\/?$/ },
  { group: "CVS Group", country: "gb", site: "https://www.cvsvets.com", sitemap: "/sitemap.xml", match: new RegExp("^/(" + CVS_REGIONS + ")/[^/]+(/[^/]+)?/?$") },   // town pages have no number; harmless
  { group: "Linnaeus", country: "gb", site: "https://www.linnaeusgroup.co.uk", list: "/our-practices", match: /^\/our-practices\/[^/]+\/?$/ },
  { group: "Pets at Home Vet Group", country: "gb", site: "https://www.vets4pets.com", sitemap: "/sitemap.xml", match: /^\/practices\/[^/]+\/[^/]+\/?$/ },
  { group: "Pets at Home Vet Group", country: "gb", site: "https://www.companioncare.co.uk", sitemap: "/sitemap.xml", match: /^\/practices\/[^/]+\/[^/]+\/?$/ },
  { group: "Sevetys", country: "fr", site: "https://sevetys.fr", sitemap: "/sitemap.xml", match: /^\/cliniques-veterinaires\/[^/]+\/?$/ },
  { group: "Mon Véto", country: "fr", site: "https://www.veterinaire-monveto.com", sitemap: "/clinic-sitemap1.xml", match: /^\/cliniques\/[^/]+\/?$/ },
  { group: "Univet", country: "fr", site: "https://univet.fr", sitemap: "/clinique-sitemap.xml", match: /^\/clinique\/[^/]+\/?$/ },
  { group: "Argos Vétérinaire", country: "fr", site: "https://www.argos-veterinaire.com", list: "/nos-cliniques-veterinaires-2", match: /^\/nos-cliniques-veterinaires-2\/clinique\/[^/]+\/?$/ },
  { group: "Iskaypet (Kivet)", country: "es", site: "https://www.kivet.com", sitemap: "/stores-sitemap.xml", match: /^\/clinicas-veterinarias\/[^/]+\/?$/ },
  { group: "Tierarzt Plus Partner", country: "de", site: "https://www.tierarztpluspartner.de", sitemap: "/portfolio-sitemap.xml", match: /^\/standort\/[^/]+\/?$/, domains: true },
  { group: "Vetopia", country: "at", site: "https://www.veterinaria.at", sitemap: "/sitemap.xml", match: /^\/standorte\/[^/]+\/?$/, domains: true },
  { group: "VetTrust", country: "ch", site: "https://vettrust.ch", sitemap: "/sitemaps/locations.xml", match: /^\/locations\/[^/]+\/?$/ },
  { group: "Gruppo Animalia", country: "it", site: "https://www.gruppoanimalia.it", sitemap: "/clinics-sitemap.xml", match: /^\/cliniche\/[^/]+\/?$/, domains: true },
  { group: "Ca' Zampa", country: "it", site: "https://www.cazampa.it", sitemap: "/clinica-sitemap.xml", match: /^\/clinica\/[^/]+\/?$/ },
  { group: "Ca' Zampa", country: "it", site: "https://www.bluvet.it", sitemap: "/sitemap-structure-1.xml", match: /^\/clinica\/[^/]+\/?$/ }
]);
const EVIDENSIA_BE = "https://evidensia.be/over-evidensia/praktijken-in-belgie/";

// Hosts that are never a clinic's own website.
// Group / sister-country sites (the BE page links "Duitsland", "Ierland", ...)
// are navigation, not practices.
const NOT_A_CLINIC = /(^|\.)((ivc)?evidensia[a-z]*\.[a-z.]+|independentvetcare\.[a-z.]+|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com|google\.[a-z.]+|goo\.gl|apple\.com|tiktok\.com|cookiebot\.com|onetrust\.com)$/i;
// Third-party services clinic pages link to (booking, careers, analytics, CDNs).
const SERVICE_HOST = /(^|\.)(gmpg\.org|wa\.me|whatsapp\.com|pinterest\.[a-z]+|vimeo\.com|kununu\.com|teamtailor\.com|provet\.com|provetcloud\.com|vetstoria\.com|petsapp\.com|doctolib\.[a-z]+|sanity\.io|ctfassets\.net|licdn\.com|clarity\.ms|fontawesome\.com|googleapis\.com|gstatic\.com|cookiedatabase\.org|w3\.org|schema\.org|wordpress\.(org|com)|plug\.it|italiaonline\.it|visualwebsiteoptimizer\.com|trustpilot\.com|maps\.app\.goo\.gl)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xml" }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

// robots.txt rules for the "*" group: Disallow prefixes and Crawl-delay.
const robotsCache = new Map();
async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const rules = { disallow: [], delay: 0 };
  let txt = "";
  try { txt = await get(origin + "/robots.txt"); } catch (e) { /* none: all allowed */ }
  let applies = false;
  for (const raw of robotsBody(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") applies = v === "*";
    else if (applies && k === "disallow" && v) rules.disallow.push(v);
    else if (applies && k === "crawl-delay" && +v > 0) rules.delay = Math.min(+v, 30);
  }
  robotsCache.set(origin, rules);
  return rules;
}
// Disallow rules are path prefixes with optional * wildcards and a $ end anchor
// (tools/robots-match.js: no RegExp, so a hostile rule can't hang the crawl).
function robotsAllowed(rules, pathname) {
  return !rules.disallow.some((rule) => ruleMatches(rule, pathname));
}
async function allowedByRobots(origin, pathname) {
  return robotsAllowed(await robotsFor(origin), pathname);
}

// Same phone key / host normalisation the app uses to match OSM vets.
const { phoneKey, hostOf, groupForHost } = require("../lib/chains.js");

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

const listCache = new Map();
async function clinicUrls(src) {
  const listUrl = src.site + (src.sitemap || src.list);
  if (!listCache.has(listUrl)) listCache.set(listUrl, get(listUrl));   // Medivet: one sitemap, three countries
  const body = await listCache.get(listUrl);
  const raw = src.sitemap
    ? [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
    : [...body.matchAll(/href="([^"#?]+)"/gi)].map((m) => { try { return new URL(decode(m[1]), src.site).href; } catch (e) { return ""; } });
  const site = new URL(src.site).hostname;
  return [...new Set(raw.filter((u) => { try { const x = new URL(u); return x.hostname === site && src.match.test(x.pathname); } catch (e) { return false; } }))];
}

// tel: links first, then structured data ("telephone": "..." in JSON-LD, used by CVS).
function phonesOn(html) {
  const raw = [...html.matchAll(/href="tel:([^"]+)"/gi), ...html.matchAll(/"telephone"\s*:\s*"([^"]+)"/gi)].map((m) => m[1]);
  return [...new Set(raw.map((s) => { try { return phoneKey(decodeURIComponent(s)); } catch (e) { return phoneKey(s); } }).filter(Boolean))];
}
function outboundHosts(html, site) {
  const own = hostOf(site);
  return [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => hostOf(m[1]))
    .filter((h) => h && h !== own && !h.endsWith("." + own) && !NOT_A_CLINIC.test(h) && !SERVICE_HOST.test(h)))];
}

// One group's clinic list. Group pages also show shared numbers (head office,
// the out-of-hours provider) and shared links (booking systems, sister sites).
// Those would mislabel other clinics, so we keep: the FIRST phone on each page
// plus phones seen on only that page; and outbound domains seen on at most a
// few pages (a practice's own site can serve its 2-3 branches) and never on
// another group's domain.
async function crawlSource(src, log) {
  const label = `${src.group} ${src.country} (${hostOf(src.site)})`;
  const listPath = src.sitemap || src.list;
  if (!(await allowedByRobots(src.site, listPath))) { log.push(`${label}: skipped, robots.txt disallows ${listPath}`); return []; }
  const urls = (await clinicUrls(src)).slice(0, +process.env.SNUFFEL_CRAWL_LIMIT || Infinity);   // limit: quick local test
  const { delay } = await robotsFor(src.site);
  const pages = [];
  for (const url of urls) {
    if (!(await allowedByRobots(src.site, new URL(url).pathname))) continue;
    await sleep(Math.max(DELAY_MS, delay * 1000));
    try {
      const html = await get(url);
      pages.push({ url, name: clinicName(html, new URL(url).pathname.split("/").filter(Boolean).pop()),
                   phones: phonesOn(html), hosts: src.domains ? outboundHosts(html, src.site) : [] });
    } catch (e) { log.push(`  ! ${url}: ${e.message}`); }
  }
  const seen = (key) => { const n = {}; pages.forEach((p) => p[key].forEach((v) => { n[v] = (n[v] || 0) + 1; })); return n; };
  const phoneCount = seen("phones"), hostCount = seen("hosts");
  const maxHostPages = Math.max(1, Math.min(5, Math.floor(pages.length * 0.2)));
  const clinics = pages.map((p) => ({
    group: src.group, country: src.country, name: p.name, url: p.url,
    phones: p.phones.filter((ph, i) => i === 0 || phoneCount[ph] === 1),
    domains: p.hosts.filter((h) => hostCount[h] <= maxHostPages && !groupForHost(h))
  }));
  log.push(`${label}: ${urls.length} clinic pages, ${clinics.filter((c) => c.phones.length).length} with phone numbers` +
           (src.domains ? `, ${clinics.filter((c) => c.domains.length).length} with their own website` : ""));
  return clinics;
}

// Every source; hosts run in parallel, pages of one host one at a time.
async function crawlAll(log) {
  const byHost = new Map();
  for (const src of SOURCES) {
    const h = hostOf(src.site);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(src);
  }
  const results = await Promise.all([...byHost.values()].map(async (srcs) => {
    const out = [];
    for (const src of srcs) {
      try { out.push(...(await crawlSource(src, log))); }
      catch (e) { log.push(`${src.group} ${src.country} (${hostOf(src.site)}): FAILED ${e.message}`); }
    }
    return out;
  }));
  const clinics = results.flat();
  try { clinics.push(...(await evidensiaBelgium(log))); }
  catch (e) { log.push(`evidensia.be: FAILED ${e.message}`); }
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

module.exports = { robotsAllowed };
if (require.main === module) (async () => {
  const mode = process.argv[2] || "all";   // crawl | build | all
  let log = [], clinics = [];
  if (mode === "crawl" || mode === "all" || (mode === "build" && !fs.existsSync(CRAWL_CACHE))) {
    clinics = await crawlAll(log);
    fs.mkdirSync(path.dirname(CRAWL_CACHE), { recursive: true });
    fs.writeFileSync(CRAWL_CACHE, JSON.stringify({ generated: new Date().toISOString(), log, clinics }));
    console.log(log.join("\n") + `\n\nwrote ${path.relative(process.cwd(), CRAWL_CACHE)}: ${clinics.length} clinics`);
    if (mode === "crawl") return;
  } else {
    ({ log, clinics } = JSON.parse(fs.readFileSync(CRAWL_CACHE, "utf8")));
  }

  // Index for the app: phone key -> clinic, domain -> clinic. A phone or domain
  // listed by two groups would be ambiguous; drop it rather than guess.
  const phones = {}, domains = {}, conflicts = new Set(), domainConflicts = new Set();
  for (const c of clinics) {
    const ref = { g: c.group, n: c.name, c: c.country };
    for (const p of c.phones || []) {
      if (phones[p] && phones[p].g !== c.group) conflicts.add(p);
      phones[p] = ref;
    }
    for (const d of (c.domains || []).concat(c.domain ? [c.domain] : [])) {
      if (domains[d] && domains[d].g !== c.group) domainConflicts.add(d);
      domains[d] = ref;
    }
  }
  conflicts.forEach((p) => delete phones[p]);
  domainConflicts.forEach((d) => delete domains[d]);
  if (conflicts.size || domainConflicts.size) log.push(`dropped ${conflicts.size} phones / ${domainConflicts.size} domains listed by two groups`);

  // A group whose list could not be read this month (site down, blocked) keeps
  // last month's official entries instead of silently turning "independent".
  const crawled = new Set(clinics.map((c) => c.group));
  const missingGroups = new Set(SOURCES.map((s) => s.group).concat("Evidensia").filter((g) => !crawled.has(g)));

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
    let kept = 0;
    for (const [kind, index] of [["phones", phones], ["domains", domains]]) {
      for (const [k, ref] of Object.entries(prev[kind] || {})) {
        if (ref.s || index[k] || !missingGroups.has(ref.g)) continue;
        index[k] = ref;
        kept++;
      }
    }
    if (kept) log.push(`kept ${kept} official entries from the previous build for groups not crawled this run: ${[...missingGroups].join(", ")}`);
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
