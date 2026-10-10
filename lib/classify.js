/* ===== Snuffel — place classification =====
 * Maps OpenStreetMap tags to a Snuffel category (vet, hospital, grooming, shop,
 * boarding, training, play, shelter) or null. Shared by the browser
 * (window.SnuffelClassify) and tools/build-places.js, so the monthly prebuilt
 * dataset and the live Overpass fallback classify places identically.
 */
(function (root) {
  "use strict";

  // Emergency/hospital signals, matched against the diacritic-folded name, so
  // plain ASCII spellings also catch "pohotovost", "całodobowa", etc.
  // Deliberately excludes a bare "klinika": most PL/CZ practices are called
  // "klinika weterynaryjna" / "veterinarni klinika" and are ordinary vets.
  var HOSPITAL_HINT = new RegExp([
    "dierenziekenhuis", "ziekenhuis", "hospital", "hopital", "spoedkliniek", "spoed",
    "emergency", "urgence",                                   // EN / NL / FR
    "tierklinik", "tierspital", "notdienst", "notfall", "notaufnahme",  // DE
    "calodobow", "pogotowie", "szpital",                      // PL
    "nonstop", "pohotovost", "nemocnice",                     // CZ
    "24[\\s/-]*uur", "24[\\s/-]*stunden", "24\\s*/\\s*7"
  ].join("|"), "i");

  // Grooming salons by name, across all six markets.
  var GROOMING_HINT = /(trimsalon|grooming|toilettage|hundesalon|hundefriseur|hundepflege|psi fryzjer|fryzjer dla ps|salon dla ps|groomer|psi salon)/i;

  // Off-leash / dog play areas by name (folded to ASCII before matching).
  var PLAY_HINT = /(honden|losloop|uitlaat|hondenweide|hundewiese|hundeauslauf|hundeplatz|hundepark|hundefreilauf|hundezone|caniparc|parc a chien|espace canin|dog ?park|wybieg dla ps|psi wybieg|psia laka|psi louka|vybeh pro psy|psi hriste|psi park)/i;

  // Lowercase + strip diacritics so one ASCII pattern matches every language.
  // NFD leaves l-stroke and sharp-s intact, so those are mapped explicitly.
  function foldName(s) {
    return String(s || "").toLowerCase()
      .replace(/ł/g, "l")     // ł (Polish)
      .replace(/ß/g, "ss")    // ß (German)
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function classify(tags) {
    tags = tags || {};
    var nm = foldName(tags.name);
    if (tags.amenity === "veterinary") {
      return HOSPITAL_HINT.test(nm + " " + foldName(tags.healthcare)) ? "hospital" : "vet";
    }
    if (tags.shop === "pet_grooming" || tags.craft === "pet_grooming") return "grooming";
    if (tags.shop === "pet" || tags.shop === "pet_care") {
      return GROOMING_HINT.test(nm) ? "grooming" : "shop";
    }
    if (tags.amenity === "animal_boarding") return "boarding";
    if (tags.amenity === "animal_shelter") return "shelter";
    // Dog trainers / behaviourists. animal_training=horse etc. are not for us.
    if (tags.amenity === "animal_training") {
      return !tags.animal_training || /dog/i.test(tags.animal_training) ? "training" : null;
    }
    if (tags.leisure === "dog_park") return "play";
    if (tags.dog === "unleashed") return "play";   // off-leash area / losloopgebied
    if (tags.leisure && PLAY_HINT.test(nm)) return "play";
    return null;
  }

  // Tags worth keeping per place (everything the app renders or matches on).
  var KEEP_TAGS = /^(name|brand|operator|brand:wikidata|amenity|shop|craft|leisure|dog|animal_training|healthcare|emergency|opening_hours|phone|contact:phone|website|contact:website|url|email|contact:email|addr:.*)$/;

  var api = { classify: classify, foldName: foldName, KEEP_TAGS: KEEP_TAGS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnuffelClassify = api;
})(typeof window !== "undefined" ? window : this);
