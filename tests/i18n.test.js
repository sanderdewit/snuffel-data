// Run with:  node tests/i18n.test.js            (all languages)
//            node tests/i18n.test.js it es      (only these)
// Every language pack must match en.json: same keys, same {placeholders}, every
// plural category the language needs, emoji prefixes kept, short button labels.
"use strict";
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "i18n");
const registry = JSON.parse(fs.readFileSync(path.join(dir, "languages.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(dir, "en.json"), "utf8"));
const only = process.argv.slice(2);
const codes = registry.languages.map((l) => l.code).filter((c) => !only.length || only.includes(c));

// Labels that sit on buttons / chips: keep them short so they fit on a phone.
const MAX_LEN = { emergencyBtn: 24, viewList: 12, viewMap: 12, close: 14, search: 16, aiSend: 14, retry: 22, useLocation: 32 };
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
const leadingEmoji = (s) => { const m = String(s).match(/^\p{Extended_Pictographic}/u); return m ? m[0] : null; };

let failures = 0;
for (const code of codes) {
  const file = path.join(dir, code + ".json");
  const errs = [];
  if (!fs.existsSync(file)) { console.log(`  MISSING ${code}.json`); failures++; continue; }
  let d;
  try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.log(`  FAIL ${code}: invalid JSON (${e.message})`); failures++; continue; }

  const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  for (const k of Object.keys(en)) if (!(k in d)) errs.push(`missing key ${k}`);
  for (const k of Object.keys(d)) if (!(k in en)) errs.push(`extra key ${k}`);
  for (const [k, ref] of Object.entries(en)) {
    const v = d[k];
    if (v == null) continue;
    if (typeof ref === "object") {
      if (typeof v !== "object") { errs.push(`${k} must be a plural object`); continue; }
      for (const c of cats) if (!v[c]) errs.push(`${k} lacks plural category "${c}"`);
      for (const [c, s] of Object.entries(v)) if (!String(s).includes("{n}")) errs.push(`${k}.${c} lacks {n}`);
      continue;
    }
    if (typeof v !== "string" || !v.trim()) { errs.push(`${k} is empty`); continue; }
    if (placeholders(v) !== placeholders(ref)) errs.push(`${k} placeholders ${placeholders(v) || "none"} != ${placeholders(ref) || "none"}`);
    const e = leadingEmoji(ref);
    if (e && !v.startsWith(e)) errs.push(`${k} must start with ${e}`);
    if (MAX_LEN[k] && v.length > MAX_LEN[k]) errs.push(`${k} is ${v.length} chars (max ${MAX_LEN[k]}): "${v}"`);
  }
  if (errs.length) { failures++; console.log(`  FAIL ${code}\n    - ` + errs.join("\n    - ")); }
  else console.log(`  ok  ${code}  (plural: ${cats.join("/")})`);
}
for (const [alias, target] of Object.entries(registry.aliases || {})) {
  if (!registry.languages.some((l) => l.code === target)) { console.log(`  FAIL alias ${alias} -> ${target}: no such language`); failures++; }
}
console.log(failures ? `\n${failures} language(s) with problems` : `\nall ${codes.length} language(s) ok`);
process.exit(failures ? 1 : 0);
