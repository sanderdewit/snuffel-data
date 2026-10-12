/* ============================================================================
 * Snuffel — fetch for untrusted URLs (clinic websites taken from OpenStreetMap)
 *
 * Anyone can put any URL in OSM, and the crawlers run inside CI. So before every
 * request, including each redirect hop, the target must be http(s) on the
 * default ports and its host must resolve only to public addresses: no
 * loopback, private networks, link-local (cloud metadata at 169.254.169.254),
 * CGNAT, multicast or unspecified. Redirects are followed by hand so every hop
 * gets the same check.
 *
 * Remaining gap: fetch resolves the name again itself, so a DNS server that
 * answers differently the second time (rebinding) is not caught here.
 * ========================================================================== */
"use strict";
const dns = require("dns");
const net = require("net");

const MAX_REDIRECTS = 5;

// [network, prefix length]
const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 4], ["240.0.0.0", 4]
].map(([a, bits]) => [v4Int(a), bits]);

function v4Int(ip) {
  return ip.split(".").reduce((n, x) => n * 256 + +x, 0);
}
function blockedV4(ip) {
  const n = v4Int(ip);
  return BLOCKED_V4.some(([net4, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(net4 / 2 ** (32 - bits)));
}
// IPv6 text -> 8 numbers of 16 bits (an embedded dotted IPv4 tail becomes the last two).
function v6Groups(ip) {
  let s = ip.replace(/%.*$/, "");   // zone id ("fe80::1%eth0")
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4Int(tail[1]);
    s = s.slice(0, -tail[1].length) + Math.floor(n / 65536).toString(16) + ":" + (n % 65536).toString(16);
  }
  const [head, rest] = s.split("::");
  const a = head ? head.split(":") : [], b = rest ? rest.split(":") : [];
  const groups = rest === undefined ? a : a.concat(Array(8 - a.length - b.length).fill("0"), b);
  return groups.map((g) => parseInt(g, 16));
}

/** True for addresses a crawler must never connect to (anything not plainly public). */
function isBlockedAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return blockedV4(ip);
  if (v !== 6) return true;
  const g = v6Groups(ip);
  // IPv4-mapped (::ffff:a.b.c.d): judge the IPv4 address
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return blockedV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join("."));
  }
  if (g.slice(0, 6).every((x) => x === 0)) return true;   // ::, ::1 and the deprecated IPv4-compatible ::/96
  if ((g[0] & 0xfe00) === 0xfc00) return true;            // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;            // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;            // ff00::/8 multicast
  return false;
}

/** Throws unless `url` is http(s) on port 80/443 and its host resolves only to public addresses. */
async function checkUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked: scheme " + u.protocol);
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("blocked: port " + u.port);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) throw new Error("blocked: " + host + " is not a public address");
  return u;
}

/** fetch() with the checks above on every hop. Returns { response, finalUrl }. */
async function safeFetch(url, options) {
  let current = url;
  for (let hop = 0; ; hop++) {
    await checkUrl(current);
    const r = await fetch(current, Object.assign({}, options, { redirect: "manual" }));
    const location = r.status >= 300 && r.status < 400 && r.headers.get("location");
    if (!location) return { response: r, finalUrl: current };
    if (r.body) await r.body.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
    current = new URL(location, current).href;
  }
}

/** The body as UTF-8 text, reading at most `maxBytes` (the rest is never downloaded). */
async function readCapped(response, maxBytes) {
  if (!response.body) return "";
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally { reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8");
}

module.exports = { safeFetch, readCapped, checkUrl, isBlockedAddress, MAX_REDIRECTS };
