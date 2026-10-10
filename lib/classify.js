/* ===== Snuffel — place classification =====
 * Maps OpenStreetMap tags to a Snuffel category (vet, hospital, grooming, shop,
 * boarding, training, play, shelter) or null. Shared by the browser
 * (window.SnuffelClassify) and tools/build-places.js, so the monthly prebuilt
 * dataset and the live Overpass fallback classify places identically.
 *
 * Name keywords are kept per language and only ever applied in context:
 *   HOSPITAL  only to places already tagged amenity=veterinary
 *   GROOMING  only to pet shops
 *   PLAY      only to leisure areas
 * so a word like "nonstop" or "24/7" can't turn a pharmacy into a vet hospital.
 * Keywords are folded exactly like place names (lowercase, diacritics removed),
 * so they can be written naturally - "Tierärztlicher Notdienst", "ветлікарня".
 */
(function (root) {
  "use strict";

  // Lowercase + strip diacritics so one pattern matches every spelling.
  // NFD leaves l-stroke and sharp-s intact, so those are mapped explicitly.
  // (Greek accents and Cyrillic й/ї/ё are folded by NFD as well.)
  function foldName(s) {
    return String(s || "").toLowerCase()
      .replace(/ł/g, "l")        // ł
      .replace(/ß/g, "ss")       // ß
      .replace(/[–—]/g, "-") // en/em dash -> hyphen ("0–24")
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  // Animal hospital / 24-hour / emergency vet. Plain "clinic" words are NOT here:
  // in most languages ("klinika", "dyreklinik", "clinica veterinaria") they are
  // ordinary practices.
  var HOSPITAL = {
    en: ["animal hospital", "veterinary hospital", "emergency", "out of hours"],
    nl: ["dierenziekenhuis", "ziekenhuis", "spoedkliniek", "spoed"],
    fr: ["hopital", "urgence"],
    de: ["tierklinik", "tierspital", "notdienst", "notfall", "notaufnahme"],
    pl: ["calodobow", "pogotowie", "szpital"],
    cs: ["nonstop", "pohotovost", "nemocnice"],
    it: ["ospedale veterinario", "pronto soccorso veterinario", "veterinario h24", "veterinaria h24", "h24"],
    es: ["hospital veterinario", "urgencias veterinarias", "urgencias"],
    pt: ["hospital veterinario", "urgencia veterinaria", "urgencias veterinarias"],
    ca: ["hospital veterinari", "urgencies"],
    da: ["dyrehospital", "dyrshospital", "dyreskadestue", "dyrlægevagt", "dyrlaegevagt", "akut dyrlæge", "akut dyrlaege"],
    sv: ["djursjukhus", "djurakut", "akutmottagning", "akutveterinar", "veterinarakut"],
    nb: ["dyresykehus", "dyrsykehus", "dyrlegevakt", "veterinærvakt", "veterinaervakt", "akuttveterinær", "akuttveterinaer", "dyreakutt"],
    fi: ["eläinsairaala", "päivystys"],
    is: ["dýraspítali", "dýralæknavakt", "dyralaeknavakt"],
    et: ["loomahaigla", "valvekliinik", "ööpäevaringne", "erakorraline"],
    lv: ["dzīvnieku slimnīca", "veterinārā slimnīca", "diennakts", "neatliekamā palīdzība", "neatliekamās palīdzības"],
    lt: ["gyvūnų ligoninė", "veterinarijos ligoninė", "visą parą", "skubi pagalba", "skubios pagalbos"],
    hu: ["állatkórház", "állatorvosi ügyelet", "ügyeletes állatorvos", "ügyelet", "non-stop"],
    ro: ["spital veterinar", "urgențe veterinare", "urgență veterinară", "non-stop"],
    bg: ["ветеринарна болница", "болница", "денонощна", "денонощно", "спешна"],
    el: ["νοσοκομείο", "εφημερία", "εφημερεύον", "24ωρο", "24ωρη", "επείγοντα"],
    sl: ["bolnišnica", "dežurna", "dežurstvo", "nujna pomoč"],
    sk: ["nemocnica", "pohotovosť"],
    hr: ["veterinarska bolnica", "bolnica za životinje", "bolnica za male životinje", "hitna veterinarska", "veterinarska hitna", "dežurna veterinarska"],
    sr: ["veterinarska bolnica", "ветеринарска болница", "bolnica za životinje", "болница за животиње", "hitna veterinarska", "хитна ветеринарска", "dežurna veterinarska", "дежурна ветеринарска"],
    sq: ["spital veterinar", "spitali veterinar", "spital për kafshë", "spitali i kafshëve", "urgjencë veterinare", "urgjenca veterinare"],
    mk: ["ветеринарна болница", "veterinarna bolnica", "болница за животни", "болница за миленици", "итна ветеринарна", "дежурна ветеринарна"],
    // "ветлікарня" / "ветеринарна лікарня" are left out: in Ukraine they are
    // usually state district vet services, not emergency hospitals.
    uk: ["лікарня для тварин", "цілодобова ветклініка", "цілодобова ветеринарна", "ветеринарная больница", "круглосуточная ветклиника"]
  };
  // Round-the-clock markers written with digits.
  var HOSPITAL_PATTERNS = ["24\\s*/\\s*7", "\\b24\\s*h\\b", "24\\s*uur", "24\\s*stunden", "24\\s*ore\\b", "24\\s*horas", "\\b0\\s*-\\s*24\\b"];

  // Dog grooming salons (applied to pet shops only).
  var GROOMING = {
    en: ["grooming", "groomer", "dog salon"],
    nl: ["trimsalon"],
    fr: ["toilettage"],
    de: ["hundesalon", "hundefriseur", "hundepflege"],
    pl: ["psi fryzjer", "fryzjer dla ps", "salon dla ps"],
    cs: ["psí salon"],
    it: ["toelettatura", "tolettatura", "toelettatore", "toeletta per cani", "toeletta cani"],
    es: ["peluquería canina", "peluquería de perros", "peluquería de mascotas", "peluquería animal", "estética canina"],
    pt: ["tosquia", "banho e tosquia", "banhos e tosquias", "estética canina", "estética animal"],
    ca: ["perruqueria canina", "perruqueria de gossos", "perruqueria de mascotes", "estètica canina"],
    da: ["hundefrisør", "hundefrisoer", "hundetrim"],
    sv: ["hundfrisör", "hundfrisering", "hundtrim", "hundsalong"],
    nb: ["hundefrisør", "hundefrisoer", "hundesalong", "hundetrim"],
    fi: ["trimmaamo", "trimmaus", "koiraparturi", "koirakampaamo", "koirien kampaamo"],
    is: ["hundasnyrt"],
    et: ["trimmisalong", "trimmimine", "koerte ilusalong", "koerte iluteenused", "koerte juuksur"],
    lv: ["suņu frizētava", "suņu frizieris", "dzīvnieku frizētava", "zoofrizētava", "zoo frizētava", "grūmings", "suņu kopšana"],
    lt: ["šunų kirpykla", "gyvūnų kirpykla", "augintinių kirpykla", "šunų kirpimas", "gyvūnų kirpimas", "grumingas", "šunų grožio salonas", "gyvūnų grožio salonas"],
    hu: ["kutyakozmetika", "kutyakozmetikus", "kutya kozmetika", "kisállatkozmetika", "kisállat kozmetika", "állatkozmetika", "kutyaszalon", "kutyafodrász", "kutyatrimmelés"],
    ro: ["toaletaj", "frizerie canină", "coafură canină", "cosmetică canină", "salon canin"],
    bg: ["груминг", "фризьор за кучета", "кучешки фризьор", "салон за кучета", "подстригване на кучета"],
    el: ["κουρείο σκύλων", "κομμωτήριο σκύλων", "κομμωτήριο κατοικιδίων", "καλλωπισμός", "περιποίηση σκύλων"],
    sl: ["pasji salon", "pasji frizer", "frizer za pse", "salon za pse", "striženje psov", "kozmetika za pse", "nega psov"],
    sk: ["psí salón", "salón pre psov", "strihanie psov", "psí kaderník", "kozmetika pre psov", "úprava psov"],
    hr: ["salon za pse", "salon za ljubimce", "salon za kućne ljubimce", "šišanje pasa", "frizerski salon za pse"],
    sr: ["salon za pse", "салон за псе", "salon za ljubimce", "салон за љубимце", "šišanje pasa", "шишање паса"],
    sq: ["sallon për qen", "sallon qensh", "sallon për kafshë", "qethje qensh", "qethje për qen"],
    mk: ["салон за кучиња", "salon za kučinja", "салон за миленици", "шишање кучиња"],
    uk: ["грумінг", "грумер", "салон для собак", "салон для тварин", "стрижка собак", "груминг"]
  };

  // Off-leash / dog play areas (applied to leisure areas only).
  var PLAY = {
    en: ["dog park", "dogpark", "dog run", "dog exercise area"],
    nl: ["honden", "losloop", "uitlaat", "hondenweide"],
    fr: ["caniparc", "parc à chien", "parc canin", "espace canin"],
    de: ["hundewiese", "hundeauslauf", "hundeplatz", "hundepark", "hundefreilauf", "hundezone"],
    pl: ["wybieg dla ps", "psi wybieg", "psia łąka", "psi park"],
    cs: ["psí louka", "výběh pro psy", "psí hřiště", "psí park"],
    it: ["area cani", "area sgambamento", "area di sgambamento", "sgambatoio", "parco cani", "parco per cani"],
    es: ["parque canino", "pipicán", "pipi-can", "pipi can", "área canina", "zona canina", "parque para perros", "espacio canino", "zona de esparcimiento canino"],
    pt: ["parque canino", "parque para cães", "parque de cães", "zona canina", "espaço canino", "área canina"],
    ca: ["parc caní", "parc per a gossos", "parc de gossos", "zona canina", "àrea canina", "espai caní"],
    da: ["hundeskov", "hundegård", "hundegard", "hundelegeplads", "hundefold"],
    sv: ["hundrastgård", "hundrastplats", "hundrastområde", "hundpark", "hundgård"],
    nb: ["hundepark", "hundeluftegård", "hundelufteområde", "hundegård"],
    fi: ["koira-aitaus", "koiraaitaus", "koirien aitaus", "koirapuisto", "koirametsä"],
    is: ["hundasvæði", "hundasvaedi", "hundagerði", "hundagerdi", "lausagöngusvæði"],
    et: ["koerte jalutusväljak", "koerte mänguväljak", "koerteväljak", "koerte väljak", "koerte jalutusala", "koerteplats", "koerapark", "koerte park"],
    lv: ["suņu laukums", "suņu pastaigu laukums", "suņu parks", "suņu pastaigu vieta", "suņu rotaļu laukums"],
    lt: ["šunų aikštelė", "šunų vedžiojimo aikštelė", "šunų parkas"],
    hu: ["kutyafuttató", "kutya futtató", "kutyás futtató", "kutyapark", "kutyás park", "kutyajátszótér", "kutyás játszótér"],
    ro: ["parc pentru câini", "parc canin", "loc de joacă pentru câini", "țarc pentru câini"],
    bg: ["площадка за кучета", "кучешка площадка", "парк за кучета", "площадка за разходка на кучета"],
    el: ["πάρκο σκύλων", "πάρκο για σκύλους", "σκυλοπάρκο"],
    sl: ["pasji park", "park za pse", "pasje igrišče", "igrišče za pse"],
    sk: ["psí park", "psie ihrisko", "ihrisko pre psov", "výbeh pre psov", "výbeh pre psy", "psí výbeh"],
    hr: ["park za pse", "pseće igralište", "igralište za pse", "pseći park", "ograđeni prostor za pse", "plaža za pse", "pseća plaža"],
    sr: ["park za pse", "парк за псе", "pseći park", "псећи парк", "igralište za pse", "игралиште за псе", "pseće igralište", "псеће игралиште"],
    sq: ["park për qen", "parku për qen", "parku i qenve"],
    mk: ["парк за кучиња", "park za kučinja", "игралиште за кучиња"],
    uk: ["майданчик для собак", "вигулу собак", "собачий майданчик", "парк для собак", "дог-парк", "догпарк", "площадка для выгула собак", "площадка для собак"]
  };

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // One case-insensitive alternation per kind, longest phrases first.
  function compile(lists, extra) {
    var seen = {}, words = [];
    Object.keys(lists).forEach(function (lang) {
      lists[lang].forEach(function (w) {
        var f = foldName(w);
        if (f && !seen[f]) { seen[f] = true; words.push(f); }
      });
    });
    words.sort(function (a, b) { return b.length - a.length; });
    return new RegExp(words.map(escapeRe).concat(extra || []).join("|"), "i");
  }
  var HOSPITAL_RE = compile(HOSPITAL, HOSPITAL_PATTERNS);
  var GROOMING_RE = compile(GROOMING);
  var PLAY_RE = compile(PLAY);

  function classify(tags) {
    tags = tags || {};
    var nm = foldName(tags.name);
    if (tags.amenity === "veterinary") {
      return HOSPITAL_RE.test(nm + " " + foldName(tags.healthcare)) || tags.emergency === "yes" ? "hospital" : "vet";
    }
    if (tags.shop === "pet_grooming" || tags.craft === "pet_grooming") return "grooming";
    if (tags.shop === "pet" || tags.shop === "pet_care") {
      return GROOMING_RE.test(nm) ? "grooming" : "shop";
    }
    if (tags.amenity === "animal_boarding") return "boarding";
    if (tags.amenity === "animal_shelter") return "shelter";
    // Dog trainers / behaviourists. animal_training=horse etc. are not for us.
    if (tags.amenity === "animal_training") {
      return !tags.animal_training || /dog/i.test(tags.animal_training) ? "training" : null;
    }
    if (tags.leisure === "dog_park") return "play";
    if (tags.dog === "unleashed") return "play";   // off-leash area / losloopgebied
    if (tags.leisure && PLAY_RE.test(nm)) return "play";
    return null;
  }

  // Tags worth keeping per place (everything the app renders or matches on).
  var KEEP_TAGS = /^(name|brand|operator|brand:wikidata|amenity|shop|craft|leisure|dog|animal_training|healthcare|emergency|opening_hours|phone|contact:phone|website|contact:website|url|email|contact:email|addr:.*)$/;

  var api = { classify: classify, foldName: foldName, KEEP_TAGS: KEEP_TAGS, HOSPITAL: HOSPITAL, GROOMING: GROOMING, PLAY: PLAY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnuffelClassify = api;
})(typeof window !== "undefined" ? window : this);
