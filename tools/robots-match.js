/* ============================================================================
 * Snuffel — robots.txt rule matching, shared by the crawlers
 *
 * Rules are path prefixes with "*" (any run of characters) and an optional
 * trailing "$" (end of the path), as in RFC 9309 and Google's parser. Turning a
 * rule into a RegExp (".*" per "*") backtracks exponentially on rules like
 * "/*a*a*a*a...a$", and robots.txt is written by whoever runs the site, so this
 * matcher never backtracks: each literal piece is searched once, left to right.
 * ========================================================================== */
"use strict";

const MAX_RULE = 500;            // longer rules are ignored (no real site needs them)
const MAX_ROBOTS = 500000;       // characters of robots.txt that are read (Google: 500 KiB)

/** The part of a robots.txt body that is parsed. */
function robotsBody(text) {
  return String(text || "").slice(0, MAX_ROBOTS);
}

/** Does `rule` match `pathname`? Over-long or empty rules never match. */
function ruleMatches(rule, pathname) {
  if (typeof rule !== "string" || !rule || rule.length > MAX_RULE) return false;
  const anchored = rule.endsWith("$");
  const parts = (anchored ? rule.slice(0, -1) : rule).replace(/\*+/g, "*").split("*");
  // the first piece is a plain prefix
  if (!pathname.startsWith(parts[0])) return false;
  if (parts.length === 1) return !anchored || pathname.length === parts[0].length;
  let pos = parts[0].length;
  const last = parts.length - 1;
  // middle pieces: leftmost occurrence is always the best choice for "*"
  for (let i = 1; i < last; i++) {
    const at = pathname.indexOf(parts[i], pos);
    if (at < 0) return false;
    pos = at + parts[i].length;
  }
  // the last piece: anywhere after `pos`, or exactly at the end when anchored
  if (anchored) return pathname.length - parts[last].length >= pos && pathname.endsWith(parts[last]);
  return pathname.indexOf(parts[last], pos) >= 0;
}

module.exports = { ruleMatches, robotsBody, MAX_RULE, MAX_ROBOTS };
