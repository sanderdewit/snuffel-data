/*
 * Dog breeds for the breed picker (app) and the breed cards (server): breeds/breeds.json.
 *
 *   node tools/build-breeds.js                  fetch the sources, rebuild breeds/breeds.json, print a summary
 *   node tools/build-breeds.js check            validate breeds/breeds.json and breeds/overrides.json (no network)
 *   options:  --cache            keep and reuse the raw downloads in tools/.cache/breeds/ (development)
 *             --summary <file>   also write the summary as Markdown (the body of the monthly pull request)
 *
 * Sources (facts only: names, numbers, groups; credited in the file):
 *   - FCI nomenclature (fci.be): the ten group pages (definitive breeds: number, name,
 *     group, section) and the page of provisionally recognised breeds.
 *   - Wikidata (CC0, query.wikidata.org): names and aliases in the 29 app languages.
 *     An item is matched on its FCI number (P528 catalogue code with catalogue = FCI)
 *     and otherwise on the English or original name; breeds/overrides.json fixes the rest.
 *   - Raad van Beheer (houdenvanhonden.nl, the Dutch kennel club): the official Dutch
 *     names. One page; robots.txt allows it.
 *   - breeds/overrides.json, kept by hand: varieties, common crosses, recognised breeds
 *     the FCI lacks, "mixed" and "other", name fixes, search aliases, the popular order.
 *
 * Ids are stable: fci-<number>, fci-<number>-<variety>, x-<cross>, nf-<breed outside
 * the FCI>, mixed, other. An id that disappears from the sources is kept with status
 * "removed", so a profile that uses it still has a name.
 * Every breed has a name in all 29 languages: the language's own label, else a close
 * language (see FALLBACK), else English. Serbian is written in Latin script (as in the app).
 * Polite: one request at a time, 1.5 s apart, a generic User-Agent, retries with a pause.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "breeds", "breeds.json");
const OVERRIDES = path.join(ROOT, "breeds", "overrides.json");
const CACHE = path.join(ROOT, "tools", ".cache", "breeds");
const UA = "snuffel-data-breeds/1.0 (https://snuffel.app)";
const LANGS = require("../i18n/languages.json").languages.map((l) => l.code);

const FCI = "https://www.fci.be";
const FCI_GROUPS = [
  "1-Sheepdogs-and-Cattledogs-except-Swiss-Cattledogs", "2-Pinscher-and-Schnauzer-Molossoid-and-Swiss-Mountain-and-Cattledogs",
  "3-Terriers", "4-Dachshunds", "5-Spitz-and-primitive-types", "6-Scent-hounds-and-related-breeds", "7-Pointing-Dogs",
  "8-Retrievers-Flushing-Dogs-Water-Dogs", "9-Companion-and-Toy-Dogs", "10-Sighthounds"
].map((g) => `${FCI}/en/nomenclature/${g}.html`);
const FCI_PROVISIONAL = `${FCI}/en/nomenclature/provisoire.aspx`;
const RVB = "https://www.houdenvanhonden.nl/hondenrassen/alle-rassen/";
const SPARQL = "https://query.wikidata.org/sparql";
const FCI_CATALOGUE = "Q38603";   // Fédération Cynologique Internationale, as P972 (catalogue) of P528
const DOG_BREED = "Q39367", DOG_CROSSBREED = "Q38547", DOG_TYPE = "Q38672";

// Close languages for a breed name, tried in order before English. Serbian (Latin
// script in the app) takes Latin labels; Cyrillic ones are transliterated.
const FALLBACK = {
  en: ["en-gb"], ca: ["es"], pt: ["pt-br"], cs: ["sk"], sk: ["cs"], sl: ["hr", "sh"],
  hr: ["sh", "bs", "sr-el", "sr"], sr: ["sr-el", "sh", "hr", "bs"], bs: ["sh", "hr"],
  mk: ["sr", "bg"], bg: ["mk"], da: ["nb", "nn", "sv"], nb: ["nn", "da", "sv"], sv: ["nb", "da"]
};
const EXTRA_LANGS = ["en-gb", "pt-br", "nn", "sh", "bs", "sr-el"];
const WIKI_LANGS = [...new Set([...LANGS, ...EXTRA_LANGS])];

// ---------------------------------------------------------------- text helpers
const SPECIAL = { "ß": "ss", "æ": "ae", "ø": "o", "œ": "oe", "đ": "d", "ł": "l", "ı": "i", "þ": "th", "ð": "d" };
/** Lowercase, no accents or punctuation: the form search compares ("Mäyräkoira" = "mayrakoira"). */
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[ßæøœđłıþð]/g, (c) => SPECIAL[c]).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const SR_LATIN = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m",
  н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š"
};
const CYRILLIC = /[Ѐ-ӿ]/;
/** Serbian Cyrillic to Latin; null when the text has letters Serbian doesn't use (Russian, Ukrainian...). */
function srLatin(s) {
  let out = "";
  for (const ch of s) {
    const low = ch.toLowerCase();
    if (!CYRILLIC.test(ch)) { out += ch; continue; }
    const t = SR_LATIN[low];
    if (t == null) return null;
    out += ch === low ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }
  return out;
}
const capFirst = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);
const SMALL = new Set(["a", "à", "and", "of", "the", "de", "des", "du", "d", "la", "le", "les", "et", "del", "dell", "della", "dello", "da", "do", "dos", "das", "van", "von", "y", "i", "e", "en", "di", "z", "ze"]);
/** FCI names are in capitals: "BERGER DE BEAUCE" -> "Berger de Beauce", "GOS D'ATURA" -> "Gos d'Atura". */
function titleCase(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim().split(" ").map((w, i) =>
    w.split("-").map((part) => part.split("'").map((p, j, all) => {
      if (!p) return p;
      if (all.length > 1 && j === 0 && SMALL.has(p) && i > 0) return p;          // d'Atura, dell'Etna
      if (i > 0 && all.length === 1 && SMALL.has(p)) return p;
      return p.replace(/\p{L}/u, (c) => c.toUpperCase());   // "(cardigan)" -> "(Cardigan)"
    }).join("'")).join("-")).join(" ");
}
const decode = (s) => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const strip = (h) => decode(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// A trailing qualifier in a label that only says "dog" or "breed": "Pointer (dog breed)".
const QUALIFIER = new RegExp("\\s*\\((?:" + [
  "dog", "dog breed", "breed", "hond", "hondenras", "hund", "hunderasse", "hunderase", "hunderace", "hundras", "hundategund", "chien", "race", "race de chien",
  "perro", "raza", "raza de perro", "cane", "razza", "razza canina", "cão", "raça", "raça de cão", "raça de gos", "pies", "rasa", "rasa psa", "rasa psów",
  "pes", "plemeno", "plemeno psa", "psí plemeno", "pas", "pasmina", "pasmina psa", "kutya", "kutyafajta", "koira", "koirarotu", "rotu", "koer", "koerte tõug",
  "ras", "câine", "rasă de câini", "šuo", "šunų veislė", "veislė", "suņu šķirne", "šķirne", "qen", "racë qeni",
  "куче", "порода куче", "кучешка порода", "раса", "раса на куче", "пас", "раса паса", "собака", "порода", "порода собак", "σκύλος", "φυλή σκύλου"
].join("|") + ")\\)\\s*$", "iu");
const cleanLabel = (s) => capFirst(String(s).replace(QUALIFIER, "").replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------- fetching
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastFetch = 0;
async function get(url, { body, accept } = {}) {
  const key = url.replace(/[^a-z0-9]+/gi, "_").slice(-120) + (body ? "_" + hash(body) : "");
  const cached = path.join(CACHE, key);
  if (OPTS.cache && fs.existsSync(cached)) return fs.readFileSync(cached, "utf8");
  for (let attempt = 1; ; attempt++) {
    const wait = lastFetch + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    try {
      const r = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: Object.assign({ "User-Agent": UA, Accept: accept || "text/html" }, body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        body, signal: AbortSignal.timeout(90000)
      });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const text = await r.text();
      if (OPTS.cache) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cached, text); }
      return text;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.error(`  retry ${attempt}: ${e.message}`);
      await sleep(10000 * attempt);
    }
  }
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0; return h.toString(36); }
async function sparql(query) {
  const text = await get(SPARQL, { body: "query=" + encodeURIComponent(query), accept: "application/sparql-results+json" });
  return JSON.parse(text).results.bindings;
}

// ---------------------------------------------------------------- FCI
/** "CHIEN DE BERGER BELGE (15) (BELGIAN SHEPHERD DOG)" -> { fci: 15, original, english } */
function parseFciName(text) {
  const m = /^(.*?)\s*\((\d+)\)\s*(?:\((.*)\))?\s*$/.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const original = titleCase(m[1]);
  return { fci: +m[2], original, english: m[3] ? titleCase(m[3]) : original };
}
function parseFciGroup(html, group) {
  const out = [];
  let section = null;
  const re = /SectionLabel_\d+">([\s\S]*?)<\/span>|<a\b[^>]*class="nom"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html));) {
    if (m[1]) { const s = /Section\s*(\d+)/i.exec(strip(m[1])); section = s ? +s[1] : null; continue; }
    const b = parseFciName(strip(m[2]));
    if (b) out.push(Object.assign(b, { group, section, status: "definitive" }));
  }
  return out;
}
function parseFciProvisional(html) {
  const out = [];
  const re = /<a\b[^>]*class="nom"[^>]*>([\s\S]*?)<\/a>\s*<div class="standard">\s*<a[^>]*href="[^"]*\/(\d+)g(\d+)-/g;
  for (let m; (m = re.exec(html));) {
    const b = parseFciName(strip(m[1]));
    if (b) out.push(Object.assign(b, { group: +m[3], section: null, status: "provisional" }));
  }
  return out;
}
async function fciBreeds() {
  const all = new Map();
  for (let g = 0; g < FCI_GROUPS.length; g++) {
    const list = parseFciGroup(await get(FCI_GROUPS[g]), g + 1);
    if (!list.length) throw new Error(`FCI group ${g + 1}: nothing parsed - page layout changed?`);
    for (const b of list) all.set(b.fci, b);
  }
  if (all.size < 300) throw new Error(`FCI: only ${all.size} definitive breeds parsed - page layout changed?`);
  const prov = parseFciProvisional(await get(FCI_PROVISIONAL));
  if (!prov.length) throw new Error("FCI provisional page: nothing parsed - page layout changed?");
  for (const b of prov) if (!all.has(b.fci)) all.set(b.fci, b);
  return all;
}

// ---------------------------------------------------------------- Wikidata
async function wikidata(extraIds) {
  const fciRows = await sparql(`SELECT ?item ?num WHERE {
    ?item p:P528 ?st . ?st ps:P528 ?num ; pq:P972 wd:${FCI_CATALOGUE} ; wikibase:rank ?rank .
    FILTER(?rank != wikibase:DeprecatedRank) }`);
  const langs = WIKI_LANGS.map((l) => `"${l}"`).join(",");
  const values = extraIds.map((q) => "wd:" + q).join(" ");
  const rows = await sparql(`SELECT ?item ?kind ?l WHERE {
    { ?item wdt:P31 wd:${DOG_BREED} } UNION { ?item wdt:P31 wd:${DOG_CROSSBREED} } UNION { ?item wdt:P31 wd:${DOG_TYPE} }
    UNION { ?item p:P528/pq:P972 wd:${FCI_CATALOGUE} } ${values ? `UNION { VALUES ?item { ${values} } }` : ""}
    { ?item rdfs:label ?l BIND("l" AS ?kind) } UNION { ?item skos:altLabel ?l BIND("a" AS ?kind) }
    FILTER(lang(?l) IN (${langs})) }`);
  const items = new Map();
  const item = (q) => items.get(q) || items.set(q, { q, labels: {}, aliases: {}, fci: [] }).get(q);
  // SPARQL returns rows in any order: sorted, the same data always gives the same file (no noise in the monthly diff)
  const key = (r) => [r.item.value, r.kind.value, r.l["xml:lang"], r.l.value].join("\u0000");
  rows.sort((a, z) => (key(a) < key(z) ? -1 : key(a) > key(z) ? 1 : 0));
  fciRows.sort((a, z) => (a.item.value + a.num.value < z.item.value + z.num.value ? -1 : 1));
  for (const r of rows) {
    const q = r.item.value.split("/").pop(), lang = r.l["xml:lang"], text = r.l.value.trim();
    if (!text) continue;
    const it = item(q);
    if (r.kind.value === "l") it.labels[lang] = text;
    else (it.aliases[lang] = it.aliases[lang] || []).push(text);
  }
  for (const r of fciRows) {
    const n = parseInt(r.num.value, 10);
    if (n > 0) item(r.item.value.split("/").pop()).fci.push(n);
  }
  return items;
}

/** FCI number -> Wikidata item: by number (one item for one breed), else on a unique name. */
function matchWikidata(fci, items, pinned) {
  const byNum = new Map();
  for (const it of items.values()) for (const n of new Set(it.fci)) (byNum.get(n) || byNum.set(n, []).get(n)).push(it);
  const byName = new Map();
  for (const it of items.values()) {
    for (const l of ["en", "en-gb", "fr", "de", "es", "it", "pt", "nl"]) {
      for (const t of [it.labels[l], ...(it.aliases[l] || [])]) {
        if (!t) continue;
        const k = norm(t);
        (byName.get(k) || byName.set(k, new Set()).get(k)).add(it);
      }
    }
  }
  const used = new Map(), result = new Map(), how = new Map();
  const take = (n, it, why) => { result.set(n, it); used.set(it.q, n); how.set(n, why); };
  for (const [n, q] of Object.entries(pinned)) if (fci.has(+n) && items.has(q)) take(+n, items.get(q), "pinned");
  for (const [n, b] of fci) {
    if (result.has(n)) continue;
    const c = (byNum.get(n) || []).filter((it) => !used.has(it.q));
    // an item that carries several FCI numbers (one article for three griffons) only as a last resort
    const single = c.filter((it) => new Set(it.fci).size === 1);
    const pick = single.length === 1 ? single[0] : single.length > 1
      ? single.find((it) => norm(it.labels.en) === norm(b.english)) || single.sort((a, z) => Object.keys(z.labels).length - Object.keys(a.labels).length)[0]
      : null;
    if (pick) take(n, pick, "number");
  }
  for (const [n, b] of fci) {
    if (result.has(n)) continue;
    const names = [b.english, b.original, ...b.english.split(/\s+-\s+|,\s*/), ...b.original.split(/\s+-\s+|,\s*/)];
    const hits = new Set();
    for (const s of names) for (const it of byName.get(norm(s)) || []) if (!used.has(it.q)) hits.add(it);
    if (hits.size === 1) take(n, [...hits][0], "name");
  }
  for (const [n] of fci) {
    if (result.has(n)) continue;
    const c = (byNum.get(n) || []).filter((it) => !used.has(it.q));
    if (c.length) take(n, c[0], "shared number");
  }
  return { result, how };
}

// ---------------------------------------------------------------- Raad van Beheer
function parseRvb(html) {
  const out = [];
  const re = /href="\/hondenrassen\/alle-rassen\/fci-groep-(\d+)\/[^"]+"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html));) { const name = strip(m[2]); if (name) out.push({ group: +m[1], name }); }
  return out;
}

// ---------------------------------------------------------------- names
/** Names in the 29 languages for one Wikidata item (or none): own label, close language, then `en`. */
function namesFor(it, en) {
  const names = {}, fallback = [];
  const label = (l) => {
    const t = it && it.labels[l];
    if (!t) return null;
    if (l === "sr" || l === "sr-el") return srLatin(t);
    return t;
  };
  for (const lang of LANGS) {
    let v = null;
    if (lang === "sr") {
      for (const l of ["sr-el", "sr", "sh", "hr", "bs"]) if ((v = label(l))) break;
    } else if (lang === "mk" || lang === "bg") {
      v = it && it.labels[lang];
      if (!v) for (const l of FALLBACK[lang]) { const t = it && it.labels[l]; if (t && CYRILLIC.test(t)) { v = t; break; } }
    } else {
      v = label(lang);
      if (!v) for (const l of FALLBACK[lang] || []) if ((v = label(l))) break;
      if (v && (lang === "hr" || lang === "sl") && CYRILLIC.test(v)) v = srLatin(v);
    }
    if (!v && lang !== "en") fallback.push(lang);
    names[lang] = v ? cleanLabel(v) : null;
  }
  names.en = enTitle(names.en || en);
  for (const lang of LANGS) if (!names[lang]) names[lang] = names.en;
  return { names, fallback };
}
/** English breed names in title case, as kennel clubs write them: "Basset hound" -> "Basset Hound". */
const enTitle = (s) => String(s).split(" ").map((w, i) => (i > 0 && (SMALL.has(w.toLowerCase()) || /^(d|dell|dall)'/i.test(w)) ? w : capFirst(w))).join(" ");

/** Search terms: every label and alias of the item and the given extra names, minus the names themselves. */
function aliasesFor(names, extra, it) {
  const taken = new Set(Object.values(names).map(norm));
  const at = new Map();   // norm -> index in out
  const out = [];
  const add = (t) => {
    if (!t || typeof t !== "string") return;
    const s = t.replace(QUALIFIER, "").replace(/\s+/g, " ").trim();
    const k = norm(s);
    if (k.length < 2 || taken.has(k)) return;
    if (at.has(k)) {   // keep the capitalised spelling: "Duitse herder" over "duitse herder"
      const i = at.get(k);
      if (out[i] === out[i].toLowerCase() && s !== s.toLowerCase()) out[i] = s;
      return;
    }
    at.set(k, out.length); out.push(s);
  };
  for (const t of extra) add(t);
  if (it) {
    for (const l of WIKI_LANGS) {
      const lab = it.labels[l];
      add(lab);
      if (lab && CYRILLIC.test(lab) && l === "sr") add(srLatin(lab));
      for (const a of it.aliases[l] || []) add(a);
    }
  }
  return out;
}

// ---------------------------------------------------------------- build
function loadJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

async function build() {
  const ov = loadJson(OVERRIDES, null);
  if (!ov) throw new Error("breeds/overrides.json is missing");
  const ovErrors = validateOverrides(ov);
  if (ovErrors.length) throw new Error("breeds/overrides.json:\n  " + ovErrors.join("\n  "));
  const previous = loadJson(OUT, { breeds: [] });

  console.error("FCI nomenclature ...");
  const fci = await fciBreeds();
  console.error(`  ${fci.size} breeds`);
  console.error("Wikidata ...");
  const extraIds = [...ov.varieties, ...ov.extra].map((e) => e.wikidata).filter(Boolean).concat(Object.values(ov.wikidata || {}));
  const items = await wikidata(extraIds);
  console.error(`  ${items.size} items`);
  const { result: wd, how } = matchWikidata(fci, items, ov.wikidata || {});
  console.error("Raad van Beheer ...");
  const rvb = parseRvb(await get(RVB));
  if (rvb.length < 200) throw new Error(`Raad van Beheer: only ${rvb.length} names parsed - page layout changed?`);

  const breeds = [];
  const fallbacks = {};
  const add = (e, it, extraAliases) => {
    const { names, fallback } = namesFor(it, e.en);
    const hand = Object.assign({}, e.names || {}, (ov.names || {})[e.id] || {});
    // a hand-written English name replaces the old one wherever that was used (fallbacks, copied labels)
    if (hand.en && hand.en !== names.en) { const old = names.en; for (const l of LANGS) if (names[l] === old) names[l] = hand.en; }
    Object.assign(names, hand);
    for (const l of fallback) if (!hand[l]) (fallbacks[l] = fallbacks[l] || []).push(e.id);
    const entry = { id: e.id, kind: e.kind, _hand: new Set(Object.keys(hand)) };
    for (const k of ["fci", "of", "group", "status", "recognised"]) if (e[k] != null) entry[k] = e[k];
    if (it) entry.wikidata = it.q;
    entry.names = names;
    entry._extra = [...(extraAliases || []), ...((ov.aliases || {})[e.id] || []), ...(e.aliases || [])];
    entry._it = it;
    breeds.push(entry);
    return entry;
  };
  for (const [n, b] of [...fci].sort((a, z) => a[0] - z[0])) {
    add({ id: "fci-" + n, kind: "breed", fci: n, group: b.group, status: b.status, en: b.english }, wd.get(n) || null, [b.english, b.original]);
  }
  for (const v of ov.varieties) {
    const parent = breeds.find((x) => x.id === v.of);
    if (!parent) throw new Error(`variety ${v.id}: parent ${v.of} is not in the FCI list`);
    add({ id: v.id, kind: "variety", of: v.of, fci: parent.fci, group: parent.group, status: parent.status, en: v.names.en, names: v.names, aliases: v.aliases },
      v.wikidata ? items.get(v.wikidata) || null : null);
  }
  for (const x of ov.extra) {
    add({ id: x.id, kind: x.kind, recognised: x.recognised, en: x.names.en, names: x.names, aliases: x.aliases }, x.wikidata ? items.get(x.wikidata) || null : null);
  }

  // Dutch: the Raad van Beheer's names, matched within the FCI group (varieties after a comma).
  const rvbReport = applyRvb(breeds, rvb, ov.rvb || {});

  // Search terms (a term that is another entry's name belongs to that entry), then the popular order.
  const nameOf = new Map();
  for (const e of breeds) for (const n of Object.values(e.names)) { const k = norm(n); (nameOf.get(k) || nameOf.set(k, new Set()).get(k)).add(e.id); }
  for (const e of breeds) {
    e.aliases = aliasesFor(e.names, e._extra, e._it).filter((a) => { const owners = nameOf.get(norm(a)); return !owners || owners.has(e.id); });
    delete e._extra; delete e._it; delete e._hand;
  }
  (ov.popular || []).forEach((id, i) => { const e = breeds.find((x) => x.id === id); if (e) e.rank = i + 1; });

  // Ids that disappeared stay, marked removed.
  const ids = new Set(breeds.map((e) => e.id));
  const removed = [];
  for (const old of previous.breeds || []) {
    if (ids.has(old.id)) continue;
    removed.push(old.id);
    breeds.push(Object.assign({}, old, { status: "removed" }));
  }
  const order = (e) => (e.kind === "mixed" ? 3 : e.kind === "other" ? 4 : e.kind === "cross" ? 2 : e.id.startsWith("nf-") ? 1 : 0);
  breeds.sort((a, z) => order(a) - order(z) || (a.fci || 0) - (z.fci || 0) || (a.kind === "variety") - (z.kind === "variety") || a.id.localeCompare(z.id));

  const data = {
    about: "Dog breeds for Snuffel's breed picker, built by tools/build-breeds.js. Breeds, numbers and groups: FCI nomenclature (fci.be). " +
      "Names and search terms: Wikidata (CC0), Dutch names checked against the Raad van Beheer (houdenvanhonden.nl). " +
      "Varieties, crosses, breeds outside the FCI, mixed and other: breeds/overrides.json.",
    languages: LANGS,
    breeds: breeds.map(tidy)
  };
  const errors = validate(data);
  if (errors.length) throw new Error("breeds.json would be invalid:\n  " + errors.slice(0, 30).join("\n  "));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, format(data));

  return summary({ data, previous, fci, wd, how, items, fallbacks, rvbReport, removed });
}

function tidy(e) {
  const out = {};
  for (const k of ["id", "kind", "fci", "of", "group", "status", "recognised", "rank", "wikidata", "names", "aliases"]) if (e[k] != null) out[k] = e[k];
  const names = {};
  for (const l of LANGS) names[l] = out.names[l];
  out.names = names;
  return out;
}
/** One breed per line: small diffs in the monthly pull request. */
function format(data) {
  return "{\n" +
    `  "about": ${JSON.stringify(data.about)},\n` +
    `  "languages": ${JSON.stringify(data.languages)},\n` +
    '  "breeds": [\n' + data.breeds.map((b) => "    " + JSON.stringify(b)).join(",\n") + "\n  ]\n}\n";
}

const VARIETY_WORDS = /\b(korthaar|langhaar|ruwhaar|stokhaar|langstokhaar|gladhaar|draadhaar|klein|groot|middenslag|miniatuur|medio|standaard)\b/g;
/** Edit distance, for spelling variants ("Franse bulldog" / "Franse buldog"). */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function applyRvb(breeds, rvb, pinned) {
  // per FCI group: the breeds' names in every language, then all their other terms
  const groups = new Map();
  for (const e of breeds) {
    if (!e.group || e.kind !== "breed") continue;
    const g = groups.get(e.group) || groups.set(e.group, []).get(e.group);
    const other = [...e._extra, ...(e._it ? Object.values(e._it.labels).concat(...Object.values(e._it.aliases)) : [])];
    g.push({ e, names: new Set(Object.values(e.names).map(norm)), other: new Set(other.map(norm)) });
  }
  const tight = (s) => s.replace(/ /g, "");
  const find = (group, key) => {
    const g = groups.get(group) || [];
    const unique = (f) => { const hits = g.filter(f); return hits.length === 1 ? hits[0].e : null; };
    const k = tight(key);
    return unique((c) => c.names.has(key)) || unique((c) => c.other.has(key)) ||
      unique((c) => [...c.names, ...c.other].some((t) => tight(t) === k)) ||
      (k.length >= 8 ? unique((c) => [...c.names].some((t) => distance(tight(t), k) <= 2)) : null);
  };
  const byId = new Map(breeds.map((e) => [e.id, e]));
  const matched = new Set(), unmatched = [], renamed = [];
  const nl = new Map();   // id -> RvB name
  for (const r of rvb) {
    if (pinned[r.name] === null) continue;   // deliberately not used
    const base = r.name.split(",")[0].trim();
    let e = pinned[r.name] ? byId.get(pinned[r.name]) : null, name = base;
    if (!e) {
      const plain = base.replace(new RegExp(VARIETY_WORDS.source, "gi"), " ").replace(/\s+/g, " ").trim();
      if (!(e = find(r.group, norm(r.name)) || find(r.group, norm(base))) && (e = find(r.group, norm(plain)))) name = plain;   // "Duitse Herdershond Stokhaar"
    }
    if (!e) { unmatched.push(r.name); continue; }
    matched.add(e.id);
    if (process.env.BREEDS_DEBUG) console.error(`rvb ${r.name} -> ${e.id} (${e.names.en})`);
    if (!nl.has(e.id)) nl.set(e.id, name);
  }
  for (const [id, name] of nl) {
    const e = byId.get(id);
    if (e._hand.has("nl")) continue;   // a name written by hand in overrides wins
    const before = e.names.nl;
    if (before !== name) { renamed.push(`${id}: ${before} -> ${name}`); e._extra.push(before); if (process.env.BREEDS_DEBUG) console.error(`nl ${id}: ${before} -> ${name}`); }
    e.names.nl = name;
  }
  const missing = breeds.filter((e) => e.kind === "breed" && e.status === "definitive" && !nl.has(e.id)).map((e) => e.id);
  return { total: rvb.length, matched: matched.size, unmatched, renamed, missing };
}

function summary({ data, previous, fci, wd, how, fallbacks, rvbReport, removed }) {
  const b = data.breeds;
  const count = (f) => b.filter(f).length;
  const prev = new Map((previous.breeds || []).map((x) => [x.id, x]));
  const added = b.filter((x) => !prev.has(x.id)).map((x) => `${x.id} ${x.names.en}`);
  const renamed = b.filter((x) => prev.has(x.id) && JSON.stringify(prev.get(x.id).names) !== JSON.stringify(x.names))
    .map((x) => `${x.id}: ` + LANGS.filter((l) => prev.get(x.id).names[l] !== x.names[l]).map((l) => `${l} "${prev.get(x.id).names[l]}" -> "${x.names[l]}"`).join(", "));
  const unmatched = [...fci.keys()].filter((n) => !wd.has(n)).map((n) => `fci-${n} ${fci.get(n).english}`);
  const byHow = {};
  for (const v of how.values()) byHow[v] = (byHow[v] || 0) + 1;
  const own = LANGS.map((l) => `${l} ${b.length - (fallbacks[l] || []).length}`).join(", ");
  const lines = [
    "## Breeds",
    `${count((x) => x.kind === "breed" && x.fci && x.status !== "removed")} FCI breeds (${count((x) => x.status === "provisional" && x.kind === "breed")} provisional), ` +
      `${count((x) => x.kind === "variety")} varieties, ${count((x) => x.id.startsWith("nf-"))} breeds outside the FCI, ${count((x) => x.kind === "cross")} crosses, mixed and other; ` +
      `${b.reduce((n, x) => n + x.aliases.length, 0)} search terms.`,
    `Wikidata: ${wd.size} of ${fci.size} FCI breeds matched (${Object.entries(byHow).map(([k, v]) => `${v} by ${k}`).join(", ")}).`,
    `Names in the language itself (the rest: a close language or English), of ${b.length}: ${own}.`,
    `Raad van Beheer: ${rvbReport.matched} breeds matched from ${rvbReport.total} names; ${rvbReport.renamed.length} Dutch names taken from it.`,
    ""
  ];
  const list = (title, arr) => { if (arr.length) lines.push(`### ${title} (${arr.length})`, ...arr.map((x) => "- " + x), ""); };
  list("New", added);
  list("Removed from the sources (kept, status removed)", removed);
  list("Names changed", renamed);
  list("FCI breeds without a Wikidata item (English name everywhere; add one to overrides.wikidata)", unmatched);
  list("Raad van Beheer names not matched (add to overrides.rvb)", rvbReport.unmatched);
  list("FCI breeds the Raad van Beheer doesn't list", rvbReport.missing);
  return lines.join("\n");
}

// ---------------------------------------------------------------- validation
const ID = /^(fci-\d{1,3}(-[a-z0-9]+)*|x-[a-z0-9]+(-[a-z0-9]+)*|nf-[a-z0-9]+(-[a-z0-9]+)*|mixed|other)$/;
const KINDS = ["breed", "variety", "cross", "mixed", "other"];
/** Problems with breeds.json, one string each; empty when it is valid. */
function validate(data) {
  const errors = [];
  if (!data || !Array.isArray(data.breeds)) return ["breeds must be an array"];
  if (JSON.stringify(data.languages) !== JSON.stringify(LANGS)) errors.push("languages must be the 29 app languages of i18n/languages.json");
  const ids = new Set(), ranks = new Set();
  for (const [i, e] of data.breeds.entries()) {
    const at = `breeds[${i}]${e && e.id ? " (" + e.id + ")" : ""}`;
    if (!e || !ID.test(e.id || "")) { errors.push(`${at}: bad id`); continue; }
    if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    ids.add(e.id);
    if (!KINDS.includes(e.kind)) errors.push(`${at}: kind must be one of ${KINDS.join(", ")}`);
    if (e.id.startsWith("fci-") !== Number.isInteger(e.fci)) errors.push(`${at}: fci-ids and fci numbers go together`);
    if (e.fci && !e.id.startsWith(`fci-${e.fci}`)) errors.push(`${at}: id does not match fci ${e.fci}`);
    if (e.kind === "variety" && !e.of) errors.push(`${at}: a variety needs "of"`);
    if (!e.names || typeof e.names !== "object") { errors.push(`${at}: names missing`); continue; }
    for (const l of LANGS) if (typeof e.names[l] !== "string" || !e.names[l].trim() || e.names[l].length > 60) errors.push(`${at}: names.${l} must be a short text`);
    for (const l of Object.keys(e.names)) if (!LANGS.includes(l)) errors.push(`${at}: unknown language ${l}`);
    if (!Array.isArray(e.aliases) || e.aliases.some((a) => typeof a !== "string" || !a.trim())) errors.push(`${at}: aliases must be texts`);
    if (e.rank != null) { if (ranks.has(e.rank)) errors.push(`${at}: duplicate rank`); ranks.add(e.rank); }
  }
  for (const e of data.breeds) if (e && e.of && !ids.has(e.of)) errors.push(`${e.id}: parent ${e.of} missing`);
  for (const must of ["mixed", "other"]) if (!ids.has(must)) errors.push(`"${must}" is missing`);
  return errors;
}
function validateOverrides(ov) {
  const errors = [];
  for (const k of ["varieties", "extra", "popular"]) if (!Array.isArray(ov[k])) errors.push(`${k} must be an array`);
  if (errors.length) return errors;
  const ids = new Set();
  for (const e of [...ov.varieties, ...ov.extra]) {
    if (!ID.test(e.id || "")) errors.push(`${e.id}: bad id`);
    if (ids.has(e.id)) errors.push(`${e.id}: duplicate`);
    ids.add(e.id);
    if (!e.names || !e.names.en) errors.push(`${e.id}: names.en is required`);
    for (const l of Object.keys(e.names || {})) if (!LANGS.includes(l)) errors.push(`${e.id}: unknown language ${l}`);
    if (e.wikidata && !/^Q\d+$/.test(e.wikidata)) errors.push(`${e.id}: wikidata must be a Q-id`);
  }
  for (const e of ov.varieties) if (!/^fci-\d+$/.test(e.of || "") || !e.id.startsWith(e.of + "-")) errors.push(`${e.id}: "of" must be its fci-<number> parent`);
  for (const e of ov.extra) {
    if (!["cross", "breed", "mixed", "other"].includes(e.kind)) errors.push(`${e.id}: kind must be cross, breed, mixed or other`);
    if (e.kind === "breed" && !e.id.startsWith("nf-")) errors.push(`${e.id}: a breed outside the FCI has an nf- id`);
    if (e.kind === "cross" && !e.id.startsWith("x-")) errors.push(`${e.id}: a cross has an x- id`);
  }
  for (const [n, q] of Object.entries(ov.wikidata || {})) if (!/^\d+$/.test(n) || !/^Q\d+$/.test(q)) errors.push(`wikidata.${n}: FCI number -> Q-id`);
  for (const [id, names] of Object.entries(ov.names || {})) for (const l of Object.keys(names)) if (!LANGS.includes(l)) errors.push(`names.${id}: unknown language ${l}`);
  if (new Set(ov.popular).size !== ov.popular.length) errors.push("popular has duplicates");
  return errors;
}
/** Overrides that point at ids breeds.json doesn't have (a typo or a breed the FCI removed). */
function danglingOverrides(ov, data) {
  const ids = new Set(data.breeds.map((e) => e.id));
  const refs = [...ov.popular, ...Object.keys(ov.names || {}), ...Object.keys(ov.aliases || {}), ...Object.values(ov.rvb || {}).filter(Boolean)];
  return [...new Set(refs.filter((id) => !ids.has(id)))];
}

const OPTS = { cache: process.argv.includes("--cache") };
if (require.main === module) {
  (async () => {
    const cmd = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "build";
    if (cmd === "check") {
      const data = loadJson(OUT, null), ov = loadJson(OVERRIDES, null);
      const errors = [...validate(data), ...validateOverrides(ov), ...danglingOverrides(ov, data).map((id) => `overrides refer to unknown id ${id}`)];
      for (const e of errors) console.error("  " + e);
      if (errors.length) { console.error(`breeds: ${errors.length} problem(s)`); process.exit(1); }
      console.log(`breeds/breeds.json: ${data.breeds.length} entries ok`);
      return;
    }
    if (cmd !== "build") { console.error("usage: node tools/build-breeds.js [check] [--cache] [--summary <file>]"); process.exit(2); }
    const text = await build();
    console.log(text);
    const i = process.argv.indexOf("--summary");
    if (i > 0 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], text + "\n");
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { norm, srLatin, titleCase, parseFciName, parseFciGroup, parseFciProvisional, parseRvb, validate, validateOverrides, danglingOverrides, LANGS };
