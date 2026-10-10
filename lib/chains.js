/* ===== Snuffel — chain ownership detection =====
 * Decides whether a vet / business belongs to a chain (AniCura, Evidensia, or
 * any OSM-branded chain) and says HOW we know, strongest evidence first:
 *   manual   - a reviewed override (tools/chain-overrides.json)
 *   official - its phone or website appears in the group's own clinic list
 *   website  - its website is on, redirects to, or declares membership of a group
 *   osm      - OpenStreetMap name / brand / operator tags
 * Acquired practices usually keep their own name ("Medisch Centrum voor Dieren"
 * is AniCura), so name matching alone misses most of them; phone numbers and
 * website domains published by the groups don't.
 *
 * Shared by the browser (window.SnuffelChains), tools/build-chains.js,
 * tools/scan-websites.js and tests/chains.test.js, so all agree exactly.
 */
(function (root) {
  "use strict";

  // Corporate vet groups (research 2026-10; owners in the snuffel-data README).
  // Name patterns only where the name is distinctive: generic or colliding words
  // ("linnaeus" streets, "argos", "kivet" = Finnish for stones, "univet",
  // "animalia", "medivet" in CZ) are matched by domain only.
  var NAME_PATTERNS = [
    { re: /\banicura\b/i, group: "AniCura" },
    { re: /\b(ivc\s*)?evidensia\b/i, group: "Evidensia" },
    { re: /\bcaressa\b/i, group: "Evidensia" },       // Caressa clinics are part of Evidensia
    { re: /\bvetpartners\b/i, group: "VetPartners" },
    { re: /\bvets\s?(4|for)\s?pets\b/i, group: "Pets at Home Vet Group" },
    { re: /\bcvs vets\b/i, group: "CVS Group" },
    { re: /\bsevetys\b/i, group: "Sevetys" },
    { re: /\bargos v[ée]t[ée]rinaire\b|\bv[ée]t[ée]rinaire argos\b/i, group: "Argos Vétérinaire" },
    { re: /\bunavets\b/i, group: "UNAVETS" },
    { re: /\btierarzt plus partner\b/i, group: "Tierarzt Plus Partner" },
    { re: /\b(vetopia|vetgruppen|helvetiera|empet|svenska veterin[äa]rgruppen)\b/i, group: "Vetopia" },
    { re: /\bvettrust\b/i, group: "VetTrust" },
    { re: /\bca'?\s?zampa\b|\bbluvet\b/i, group: "Ca' Zampa" },
    { re: /\bluxvet\b/i, group: "LuxVet" }
  ];
  function hosts(list) { return new RegExp("(^|\\.)(" + list.join("|").replace(/\./g, "\\.") + ")$", "i"); }
  var GROUP_HOSTS = [
    { re: /(^|\.)anicura\.[a-z.]+$/i, group: "AniCura" },
    { re: /(^|\.)(ivc)?evidensia\.[a-z.]+$/i, group: "Evidensia" },
    { re: /(^|\.)caressa\.[a-z.]+$/i, group: "Evidensia" },
    { re: /(^|\.)vetpartners[a-z]*\.[a-z.]+$/i, group: "VetPartners" },
    { re: hosts(["swissvetgroup.com"]), group: "VetPartners" },
    { re: hosts(["medivetgroup.com", "medivet.co.uk"]), group: "Medivet" },
    { re: hosts(["cvsvets.com", "cvsukltd.co.uk", "cvsgroupplc.com"]), group: "CVS Group" },
    { re: hosts(["linnaeusgroup.co.uk"]), group: "Linnaeus" },
    { re: hosts(["vets4pets.com", "companioncare.co.uk"]), group: "Pets at Home Vet Group" },
    { re: hosts(["sevetys.fr"]), group: "Sevetys" },
    { re: hosts(["veterinaire-monveto.com"]), group: "Mon Véto" },
    { re: hosts(["univet.fr"]), group: "Univet" },
    { re: hosts(["argos-veterinaire.com", "argos-veterinaire.fr"]), group: "Argos Vétérinaire" },
    { re: hosts(["unavets.com"]), group: "UNAVETS" },
    { re: hosts(["kivet.com"]), group: "Iskaypet (Kivet)" },
    { re: hosts(["tierarztpluspartner.de"]), group: "Tierarzt Plus Partner" },
    { re: hosts(["vetopia.com", "vetgruppen.dk", "vetgruppen.de", "empet.no", "svenskavet.se", "helvetiera.ch",
                 "veterinaria.at", "vireagroup.fi", "vetthing.co.uk"]), group: "Vetopia" },
    { re: hosts(["vettrust.ch"]), group: "VetTrust" },
    { re: hosts(["gruppoanimalia.it"]), group: "Gruppo Animalia" },
    { re: hosts(["cazampa.it", "bluvet.it"]), group: "Ca' Zampa" },
    { re: hosts(["grupaluxvet.pl"]), group: "LuxVet" }
  ];
  // Group names as clinic websites write them ("part of the VetPartners family"),
  // for tools/scan-websites.js. Only names that can't be ordinary words.
  var SCAN_NAMES = [
    { re: "anicura", group: "AniCura" },
    { re: "ivc\\s*evidensia|evidensia|caressa", group: "Evidensia" },
    { re: "vetpartners", group: "VetPartners" },
    { re: "medivet", group: "Medivet" },
    { re: "linnaeus veterinary|mars veterinary health", group: "Linnaeus" },
    { re: "cvs group|cvs \\(uk\\)", group: "CVS Group" },
    { re: "sevetys", group: "Sevetys" },
    { re: "mon v[ée]to", group: "Mon Véto" },
    { re: "argos v[ée]t[ée]rinaire", group: "Argos Vétérinaire" },
    { re: "unavets", group: "UNAVETS" },
    { re: "tierarzt plus partner", group: "Tierarzt Plus Partner" },
    { re: "vetopia|vetgruppen|helvetiera|svenska veterin[äa]rgruppen", group: "Vetopia" },
    { re: "vettrust", group: "VetTrust" },
    { re: "gruppo animalia", group: "Gruppo Animalia" },
    { re: "ca'? ?zampa|bluvet", group: "Ca' Zampa" },
    { re: "luxvet", group: "LuxVet" }
  ];

  // Last 8 digits: identical for "079-3605470", "+31 79 360 5470", "0031793605470",
  // and for Belgian 8-digit landlines in national and +32 form.
  function phoneKey(s) {
    var d = String(s || "").replace(/\D/g, "");
    return d.length >= 8 ? d.slice(-8) : null;
  }

  function hostOf(u) {
    if (!u) return null;
    var m = String(u).trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\/]*@)?([^\/:?#\s]+)/i);
    return m ? m[1].toLowerCase().replace(/^www\./, "").replace(/\.$/, "") : null;
  }

  function allValues(v) {
    return v ? String(v).split(";").map(function (x) { return x.trim(); }).filter(Boolean) : [];
  }

  function groupForHost(host) {
    for (var i = 0; i < GROUP_HOSTS.length; i++) if (GROUP_HOSTS[i].re.test(host)) return GROUP_HOSTS[i].group;
    return null;
  }

  // tags: OSM tags. ref: the parsed web/data/chains.json (or null). id: "n123".
  // Returns { group, via } or null; { group: null, via: "manual" } = verified independent.
  function detect(tags, ref, id) {
    tags = tags || {};
    ref = ref || {};

    if (id && ref.overrides && Object.prototype.hasOwnProperty.call(ref.overrides, id)) {
      return { group: ref.overrides[id].chain || null, via: "manual" };
    }

    var phones = allValues(tags.phone).concat(allValues(tags["contact:phone"]));
    for (var i = 0; ref.phones && i < phones.length; i++) {
      var p = ref.phones[phoneKey(phones[i])];
      if (p) return { group: p.g, via: p.s || "official" };
    }

    var hosts = allValues(tags.website).concat(allValues(tags["contact:website"]), allValues(tags.url))
      .concat(allValues(tags.email).concat(allValues(tags["contact:email"]))
        .map(function (e) { return e.split("@")[1]; }))
      .map(hostOf).filter(Boolean);
    for (var j = 0; j < hosts.length; j++) {
      var d = ref.domains && ref.domains[hosts[j]];
      if (d) return { group: d.g, via: d.s || "official" };
      var g = groupForHost(hosts[j]);
      if (g) return { group: g, via: "website" };
    }

    var hay = (tags.name || "") + " " + (tags.brand || "") + " " + (tags.operator || "");
    for (var k = 0; k < NAME_PATTERNS.length; k++) {
      if (NAME_PATTERNS[k].re.test(hay)) return { group: NAME_PATTERNS[k].group, via: "osm" };
    }
    if (tags["brand:wikidata"]) {
      return { group: allValues(tags.brand)[0] || allValues(tags.name)[0] || "?", via: "osm" };
    }
    return null;
  }

  var api = { detect: detect, phoneKey: phoneKey, hostOf: hostOf, groupForHost: groupForHost, allValues: allValues, NAME_PATTERNS: NAME_PATTERNS, SCAN_NAMES: SCAN_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnuffelChains = api;
})(typeof window !== "undefined" ? window : this);
