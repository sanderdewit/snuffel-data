/* ===== Snuffel — OSM opening_hours evaluation =====
 * A pragmatic subset of the OSM opening_hours spec, tuned for "is it open right
 * now?" on vet and shop listings:
 *   - 24/7
 *   - weekday specs: Mo-Fr, Sa,Su, wrapping ranges like Fr-Mo
 *   - several time ranges per day, "off" / "closed"
 *   - ";" rules REPLACE earlier rules for the same days (per the spec), while
 *     "," rules ADD to them: "Mo-Fr 09:00-18:00, Sa 10:00-14:00"
 *   - overnight ranges (18:00-08:00, 20:00-26:00) spill into the next morning
 *   - "||" fallback parts ("by appointment") are ignored
 * Rules it can't evaluate (months, weeks, nth weekday, easter, sunrise...) are
 * skipped, and when any were skipped it never answers "closed" - only "open" or
 * unknown. Emergency mode hides closed vets, so a false "closed" is the worst
 * possible failure here.
 *
 * "Now" is read on the PLACE's wall clock, not the visitor's: someone in London
 * looking at a vet in Athens must see what a person outside that clinic sees.
 * tzFor(cc, lat, lon) maps the country code the data build stores on each place
 * (plus the Canaries / Azores / Madeira) to its time zone. Without a country
 * (live Overpass fallback) the device's own zone is used.
 *
 * week() gives the parsed week, for a table of opening hours, and nextChange()
 * the next closing or opening time ("closes at 18:00", "opens Tuesday 09:00").
 * Both say nothing rather than something wrong: only when every rule was
 * understood, so a skipped rule can never hide an opening.
 *
 * Works in the browser (window.SnuffelHours) and in Node (module.exports), so
 * tests/hours.test.js can exercise it without a browser.
 */
(function (root) {
  "use strict";

  var DAY = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
  var WEEKDAY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var MARKET_TZ = undefined;   // undefined = the device's own time zone
  // Countries outside Central European Time; every other covered country is CET.
  var TZ = {
    gb: "Europe/London", gg: "Europe/London", je: "Europe/London", im: "Europe/London", ie: "Europe/Dublin",
    pt: "Europe/Lisbon", is: "Atlantic/Reykjavik", fo: "Atlantic/Faroe",
    fi: "Europe/Helsinki", ee: "Europe/Tallinn", lv: "Europe/Riga", lt: "Europe/Vilnius",
    ua: "Europe/Kyiv", md: "Europe/Chisinau", ro: "Europe/Bucharest", bg: "Europe/Sofia",
    gr: "Europe/Athens", cy: "Asia/Nicosia"
  };
  function tzFor(cc, lat, lon) {
    if (!cc) return MARKET_TZ;
    cc = String(cc).toLowerCase();
    if (cc === "es" && lat < 30 && lon < -13) return "Atlantic/Canary";
    if (cc === "pt" && lon < -24) return "Atlantic/Azores";
    if (cc === "pt" && lat < 34) return "Atlantic/Madeira";
    return TZ[cc] || "Europe/Paris";
  }
  var COMPLEX = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|week|easter)\b|\[|sunrise|sunset|dawn|dusk/;
  var DAY_TOKEN = "(?:mo|tu|we|th|fr|sa|su|ph|sh)";
  var DAY_SPEC = new RegExp("^(" + DAY_TOKEN + "(?:\\s*[-,]\\s*" + DAY_TOKEN + ")*)\\b\\s*(.*)$");
  // Not spec, but common in the wild: "Mon-Fri", "Saturday".
  var LONG_DAY = /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/g;

  // Day of week (0 = Sunday) and minutes past midnight on the markets' wall clock.
  // Creating an Intl.DateTimeFormat is slow (~0.3 ms): one per time zone, reused,
  // and "now" is computed once per zone per minute - a list of thousands of
  // places is evaluated on every re-render.
  var formatters = {}, nowCache = {};
  function marketNow(date, tz) {
    var key = tz || "";
    if (!date) {
      var minute = Math.floor(Date.now() / 60000), hit = nowCache[key];
      if (hit && hit.minute === minute) return hit.value;
      var value = marketNow(new Date(minute * 60000), tz);
      nowCache[key] = { minute: minute, value: value };
      return value;
    }
    var fmt = formatters[key] || (formatters[key] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || MARKET_TZ, weekday: "short",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }));
    var parts = fmt.formatToParts(date);
    var v = {};
    parts.forEach(function (p) { v[p.type] = p.value; });
    // "% 24": some engines still print midnight as "24" despite hourCycle h23.
    return { day: WEEKDAY_SHORT[v.weekday], minutes: (+v.hour % 24) * 60 + (+v.minute) };
  }

  // Weekdays (0-6) covered by a spec like "mo-fr", "sa,su" or "fr-mo".
  // PH / SH (public and school holidays) aren't evaluated, so they cover nothing.
  function daysOf(spec) {
    var days = [];
    spec.split(",").forEach(function (tk) {
      var p = tk.split("-");
      if (p.length === 2) {
        var a = DAY[p[0].trim()], b = DAY[p[1].trim()];
        if (a == null || b == null) return;
        for (var d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
      } else if (DAY[tk.trim()] != null) {
        days.push(DAY[tk.trim()]);
      }
    });
    return days;
  }

  // Split into rules, recording whether each REPLACES (";") or ADDS TO (",") the
  // ones before it. A comma only separates rules when it follows a time or "off"
  // and precedes a weekday - "Mo,We 09:00-12:00" and "08:00-12:00,13:00-17:00"
  // are single rules.
  function splitRules(s) {
    var rules = [];
    s.split(";").forEach(function (part) {
      part.replace(/(\d|off|closed)\s*,\s*(?=(?:mo|tu|we|th|fr|sa|su|ph)\b)/g, "$1\u0000")
        .split("\u0000")
        .forEach(function (text, i) { rules.push({ text: text.trim(), additive: i > 0 }); });
    });
    return rules;
  }

  function parseRanges(rest) {
    var out = [], re = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g, m;
    while ((m = re.exec(rest))) {
      out.push([(+m[1]) * 60 + (+m[2]), (+m[3]) * 60 + (+m[4])]);
    }
    return out;
  }

  // The rules of one opening_hours string, per weekday: null (no data),
  // { always: true } (24/7), or { week, recognized, skipped }.
  function parse(str) {
    if (!str) return null;
    var s = String(str).split("||")[0].trim().toLowerCase()
      .replace(LONG_DAY, function (m) { return m.slice(0, 2); });
    if (!s) return null;
    if (/24\s*\/\s*7/.test(s)) return { always: true };

    var week = [null, null, null, null, null, null, null];   // ranges per weekday
    var recognized = false, skipped = false;

    splitRules(s).forEach(function (rule) {
      if (!rule.text) return;
      if (COMPLEX.test(rule.text)) { skipped = true; return; }
      var days, rest;
      var dm = rule.text.match(DAY_SPEC);
      if (dm) { days = daysOf(dm[1]); rest = dm[2]; }
      else { days = [0, 1, 2, 3, 4, 5, 6]; rest = rule.text; }   // no weekday = every day
      if (!days.length) return;                                   // e.g. "PH off"

      var closed = /\b(off|closed)\b/.test(rest);
      var ranges = closed ? [] : parseRanges(rest);
      if (!closed && !ranges.length) { skipped = true; return; }
      recognized = true;
      days.forEach(function (d) {
        week[d] = rule.additive && !closed && week[d] ? week[d].concat(ranges) : ranges;
      });
    });

    return { week: week, recognized: recognized, skipped: skipped };
  }

  // Returns null (no data), or { open: true | false | null, always: boolean }.
  // `now` is a Date (default: current time) or a { day, minutes } object;
  // `tz` the place's time zone (see tzFor), default the device's.
  function evaluate(str, now, tz) {
    var p = parse(str);
    if (!p) return null;
    if (p.always) return { open: true, always: true };
    if (!p.recognized) return { open: null, always: false };
    var week = p.week, skipped = p.skipped;
    var t = now && now.day != null ? now : marketNow(now, tz);

    var cur = t.minutes, yesterday = (t.day + 6) % 7;
    var open = (week[t.day] || []).some(function (r) {
      var end = r[1] <= r[0] ? 1440 : Math.min(r[1], 1440);
      return cur >= r[0] && cur < end;
    }) || (week[yesterday] || []).some(function (r) {
      // Yesterday's overnight range spilling into this morning.
      var spill = r[1] <= r[0] ? r[1] : r[1] - 1440;
      return spill > 0 && cur < spill;
    });

    if (!open && skipped) return { open: null, always: false };
    return { open: open, always: false };
  }

  // The week for a table: null (no data), { always: true } (24/7), or
  // { days, complete }. days[d] (0 = Sunday) lists [start, end] in minutes past
  // midnight; an end at or before the start, or past 24:00, runs into the next day.
  // complete: every rule was understood, so a day without ranges is closed;
  // otherwise such a day is unknown (and the table should say so).
  function week(str) {
    var p = parse(str);
    if (!p) return null;
    if (p.always) return { always: true };
    if (!p.recognized) return null;
    return { days: p.week.map(function (r) { return (r || []).map(function (x) { return [x[0], x[1]]; }); }), complete: !p.skipped };
  }

  // The next change: { open: true, at } while open (it closes then), { open: false, at }
  // while closed (it opens then), with at = { day (0 = Sunday), minutes, daysAhead }.
  // null when it can't be told: no data, 24/7 or open all week, a rule it didn't
  // understand, or no opening within the next 7 days.
  function nextChange(str, now, tz) {
    var p = parse(str);
    if (!p || p.always || !p.recognized || p.skipped) return null;
    var t = now && now.day != null ? now : marketNow(now, tz);
    // Open intervals from the start of yesterday to 8 days ahead, in minutes from today 00:00.
    var spans = [];
    for (var d = -1; d <= 8; d++) {
      (p.week[(t.day + d + 7) % 7] || []).forEach(function (r) {
        var start = d * 1440 + r[0], end = r[1] <= r[0] ? (d + 1) * 1440 + r[1] : d * 1440 + r[1];
        if (end > start) spans.push([start, end]);
      });
    }
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    spans.forEach(function (x) {
      var last = merged[merged.length - 1];
      if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);   // overlapping or back to back
      else merged.push([x[0], x[1]]);
    });
    var cur = t.minutes, LIMIT = 7 * 1440;
    var at = function (m) { var ahead = Math.floor(m / 1440); return { day: (t.day + ahead) % 7, minutes: m - ahead * 1440, daysAhead: ahead }; };
    for (var i = 0; i < merged.length; i++) {
      var s = merged[i];
      if (cur >= s[0] && cur < s[1]) return s[1] - cur >= LIMIT ? null : { open: true, at: at(s[1]) };
      if (s[0] > cur) return s[0] - cur > LIMIT ? null : { open: false, at: at(s[0]) };
    }
    return null;
  }

  var api = { evaluate: evaluate, week: week, nextChange: nextChange, marketNow: marketNow, tzFor: tzFor, MARKET_TZ: MARKET_TZ };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnuffelHours = api;
})(typeof window !== "undefined" ? window : this);
