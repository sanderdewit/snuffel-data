// Run with:  node tests/hours.test.js
// Exercises web/js/hours.js without a browser. Days: 0 = Sunday ... 6 = Saturday.
"use strict";
const assert = require("assert");
const { evaluate, marketNow, tzFor } = require("../lib/hours.js");

const SUN = 0, MON = 1, TUE = 2, WED = 3, FRI = 5, SAT = 6;
const at = (day, hh, mm = 0) => ({ day, minutes: hh * 60 + mm });
const open = (str, now) => { const r = evaluate(str, now); return r && r.open; };

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log("opening_hours");

test("simple weekday range", () => {
  assert.strictEqual(open("Mo-Fr 09:00-18:00", at(WED, 10)), true);
  assert.strictEqual(open("Mo-Fr 09:00-18:00", at(WED, 18)), false);   // end is exclusive
  assert.strictEqual(open("Mo-Fr 09:00-18:00", at(SAT, 10)), false);
});

test("';' rules override earlier rules for the same day (was: Sunday shown open)", () => {
  assert.strictEqual(open("Mo-Su 08:00-20:00; Su off", at(SUN, 12)), false);
  assert.strictEqual(open("Mo-Su 08:00-20:00; Su off", at(MON, 12)), true);
  assert.strictEqual(open("Mo-Fr 08:00-12:00; We 14:00-18:00", at(WED, 10)), false);
  assert.strictEqual(open("Mo-Fr 08:00-12:00; We 14:00-18:00", at(WED, 15)), true);
});

test("',' rules add to earlier rules (was: Saturday lost)", () => {
  assert.strictEqual(open("Mo-Fr 09:00-18:00, Sa 10:00-14:00", at(SAT, 11)), true);
  assert.strictEqual(open("Mo-Fr 09:00-18:00, Sa 10:00-14:00", at(SAT, 15)), false);
  assert.strictEqual(open("Mo-Fr 09:00-18:00, Sa 10:00-14:00", at(FRI, 10)), true);
  assert.strictEqual(open("Mo-Fr 08:00-12:00, We 14:00-18:00", at(WED, 15)), true);
  assert.strictEqual(open("Mo-Fr 08:00-12:00, We 14:00-18:00", at(WED, 10)), true);
});

test("commas inside one rule are not rule separators", () => {
  assert.strictEqual(open("Mo,We,Fr 09:00-12:00", at(WED, 10)), true);
  assert.strictEqual(open("Mo,We,Fr 09:00-12:00", at(TUE, 10)), false);
  assert.strictEqual(open("Mo-Fr 08:00-12:00,13:00-17:00", at(WED, 12, 30)), false);
  assert.strictEqual(open("Mo-Fr 08:00-12:00,13:00-17:00", at(WED, 14)), true);
});

test("overnight ranges spill into the next morning (was: missed after midnight)", () => {
  assert.strictEqual(open("Fr 20:00-02:00", at(SAT, 1)), true);
  assert.strictEqual(open("Fr 20:00-02:00", at(FRI, 1)), false);
  assert.strictEqual(open("Fr 20:00-02:00", at(FRI, 21)), true);
  assert.strictEqual(open("Mo-Fr 18:00-08:00; Sa,Su 00:00-24:00", at(TUE, 3)), true);
  assert.strictEqual(open("Mo-Fr 18:00-08:00; Sa,Su 00:00-24:00", at(SAT, 7)), true);
  assert.strictEqual(open("Mo-Fr 20:00-26:00", at(TUE, 1)), true);   // extended-hours notation
  assert.strictEqual(open("Mo-Su 08:00-00:00", at(WED, 23, 30)), true); // "until midnight"
});

test("wrapping weekday ranges", () => {
  assert.strictEqual(open("Fr-Mo 10:00-16:00", at(SUN, 12)), true);
  assert.strictEqual(open("Fr-Mo 10:00-16:00", at(WED, 12)), false);
});

test("24/7 and explicit full days", () => {
  assert.deepStrictEqual(evaluate("24/7", at(WED, 3)), { open: true, always: true });
  assert.strictEqual(open("Mo-Su 00:00-24:00", at(SUN, 23, 59)), true);
});

test("holiday-only rules carry no weekday information", () => {
  assert.strictEqual(open("PH off", at(WED, 10)), null);
  assert.strictEqual(open("Mo-Sa 09:00-18:00; Su,PH off", at(SUN, 12)), false);
});

test("fallback '||' parts are ignored", () => {
  assert.strictEqual(open('Mo-Fr 08:00-17:00 || "by appointment"', at(WED, 10)), true);
});

test("never a false 'closed' when a rule was skipped", () => {
  assert.strictEqual(open("Jan-Mar Mo-Fr 08:00-12:00", at(WED, 10)), null);
  assert.strictEqual(open("sunrise-sunset", at(WED, 10)), null);
  assert.strictEqual(open("Mo-Fr 09:00-17:00; Dec 25 off", at(WED, 10)), true);
  assert.strictEqual(open("Mo-Fr 09:00-17:00; Dec 25 off", at(WED, 20)), null);
});

test("long weekday names are tolerated", () => {
  assert.strictEqual(open("Mon-Fri 09:00-17:00", at(WED, 10)), true);
  assert.strictEqual(open("Mon-Fri 09:00-17:00", at(SAT, 10)), false);
});

test("empty / missing input", () => {
  assert.strictEqual(evaluate(""), null);
  assert.strictEqual(evaluate(null), null);
});

console.log("place timezone");

test("'now' is read on the place's own clock", () => {
  const at = new Date("2026-10-10T22:30:00Z");   // Sat 23:30 London, Sun 00:30 Amsterdam, Sun 01:30 Athens
  assert.deepStrictEqual(marketNow(at, tzFor("nl")), { day: SUN, minutes: 30 });
  assert.deepStrictEqual(marketNow(at, tzFor("gb")), { day: 6, minutes: 23 * 60 + 30 });
  assert.deepStrictEqual(marketNow(at, tzFor("gr")), { day: SUN, minutes: 90 });
  // Winter: 07:15 UTC is Thursday 08:15 in Paris (CET, UTC+1).
  assert.deepStrictEqual(marketNow(new Date("2026-01-15T07:15:00Z"), tzFor("fr")), { day: 4, minutes: 8 * 60 + 15 });
  // A Date passed straight to evaluate() goes through the same conversion.
  assert.strictEqual(evaluate("Su 00:00-01:00", at, tzFor("de")).open, true);
  assert.strictEqual(evaluate("Su 00:00-01:00", at, tzFor("ie")).open, false);
});

test("islands and fallbacks", () => {
  assert.strictEqual(tzFor("es", 28.1, -15.4), "Atlantic/Canary");
  assert.strictEqual(tzFor("es", 40.4, -3.7), "Europe/Paris");
  assert.strictEqual(tzFor("pt", 37.7, -25.7), "Atlantic/Azores");
  assert.strictEqual(tzFor("pt", 32.6, -16.9), "Atlantic/Madeira");
  assert.strictEqual(tzFor("pt", 38.7, -9.1), "Europe/Lisbon");
  assert.strictEqual(tzFor(null), undefined);                       // no country: device zone
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
