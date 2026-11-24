/* ============================================================================
 * Snuffel — the words tools/overture.js reads places' names with, per language
 *
 * tools/overture.js started with Dutch and Polish words in its own patterns; these
 * lists add the other languages of Snuffel's countries. Every list is used for every
 * country: a name is matched against all languages at once (a Dutch salon may have
 * an English name, a Swiss one a German, French or Italian one).
 *
 * Words are written as people write them; they are folded like the names
 * (lib/classify.js foldName: lower case, accents off, "ł" -> "l", "ß" -> "ss";
 * "æ", "ø", "ð" and "þ" stay). A word matches anywhere in the name ("hundeschule"
 * in "Hundeschule Pfotenglück", "pension" in "Tierpension"), except:
 *   "^word"  only at the start of a word ("^gatt": "Gattile", not "Fugatti")
 *   "=word"  only as a whole word ("=spa": "SPA de Lyon", not "Spaniel")
 * Short words that mean something else in another language are whole words or left
 * out (Dutch "pas", Albanian "pse", Catalan "pes", Portuguese "cão" -> "cao").
 * ========================================================================== */
"use strict";

module.exports = {
  // A word for dogs in a name: "Salon für Hund & Katze" is not a salon for cats only.
  dogName: {
    de: ["^hund"], fr: ["^chien", "^canin"], it: ["^cane", "=cani", "^cagnol", "^cinofil"], es: ["^perr", "^canin", "^cachorr"],
    ca: ["=gos", "^gossos", "^gosset"], pt: ["=cao", "=caes", "^cachorr", "^canin"], da: ["^hund"], sv: ["^hund"], nb: ["^hund"],
    fi: ["^koir"], is: ["^hund"], et: ["^koer"], lv: ["=suns", "=suni", "^sunu", "^sunim"], lt: ["=suo", "^sunys", "=suns", "^sunu", "^sunim"],
    cs: ["=pes", "=psi", "=psu", "^pejsk", "^psic"], sk: ["^psic", "=psi", "^psik", "^psia", "^psie"], hu: ["^kutya", "=eb", "^ebek"],
    ro: ["^caine", "^caini", "^catel", "^canin"], bg: ["^куче", "^кучет", "^кучеш"], mk: ["^кучињ", "^куче", "^кучиња"],
    sr: ["=pse", "^psec", "^псе", "=пас", "=пси", "=пса", "^псећ"], hr: ["^psec", "=psi", "=pse"], sl: ["=pes", "=psi", "=pse"],
    el: ["^σκυλ", "^κυνο"], uk: ["^собак", "^собач", "=пес", "=пси", "^песик", "^цуцен", "^щен"], sq: ["=qen", "^qenv", "^qensh"],
    mt: ["=kelb", "=klieb"], en: ["^dog", "^pupp", "^canine", "^k9"]
  },
  // A salon for cats only, by name ("Katzensalon", "Salon pour chats"): left out.
  cat: {
    de: ["^katze", "^katz", "stubentiger"], fr: ["=chat", "=chats", "^chatterie", "^felin"], it: ["^gatt", "^felin"], es: ["=gato", "=gatos", "^gatun", "^felin"],
    ca: ["=gat", "=gats", "^gatet"], pt: ["=gato", "=gatos", "^gatil", "^felin"], da: ["=kat", "^katte"], nb: ["^katt"],
    sv: ["^katt"], fi: ["^kissa", "^kisso"], is: ["=kottur", "=kettir", "^katta"],
    et: ["=kass", "^kassi", "^kasside"], lv: ["=kakis", "^kaku", "^kaki"], lt: ["^kaciu"],
    cs: ["^kock", "^kocic", "^kocek"], sk: ["^mack", "^macac"], hu: ["^macsk", "^cica"], ro: ["^pisic", "^felin"],
    bg: ["^котк", "^котеш"], mk: ["^мачк", "^мачињ"], sr: ["^mack", "^мачк", "^macij"], hr: ["^mack", "^macak"], sl: ["^mack", "^macj"],
    el: ["^γατ"], uk: ["=кіт", "=кот", "^котів", "^котик", "^коты", "^кошк", "^кішк", "^кошач", "^котяч"], sq: ["=mace"],
    mt: ["=qattus", "=qtates"], en: ["=kitty", "=kitten", "=kittens", "^feline"]
  },
  // Words that say what a place is, not which one it is: no evidence that two names
  // are the same place (whole words; tools/overture.js shareWord).
  generic: {
    de: "hund hunde hundesalon hundefriseur hundepflege hundeschule hundetraining hundepension tierpension hundehotel tierheim tierschutz tierschutzverein verein zoohandlung zoofachhandel tierbedarf tier tiere tierarzt und der die das fur von zum zur bei mit",
    fr: "chien chiens chat chats toilettage toiletteur toiletteuse salon pension canine canin animaux animalerie refuge spa education educateur ecole club association des les pour aux une",
    it: "cane cani toelettatura toelettatore pensione canile scuola cinofila cinofilo centro addestramento animali negozio dog per del della dei degli con",
    es: "perro perros peluqueria canina canino mascotas mascota residencia guarderia adiestramiento escuela centro protectora animales tienda del los las por con",
    ca: "gos gossos perruqueria canina residencia escola botiga animals per dels les",
    pt: "cao caes banho banhos tosquia tosquias hotel canil loja animais escola treino centro dos das para com",
    da: "hund hunde hundefrisor hundefrisør hundepension hundeskole hundetraening dyrehandel dyrenes dyr dyreinternat og til med",
    sv: "hund hundar hundfrisor hundsalong hundpensionat hunddagis hundskola djuraffar djurbutik djur djurhem och med",
    nb: "hund hunder hundefrisor hundefrisør hundepensjonat hundeskole dyrebutikk dyr dyrehjem og til med",
    fi: "koira koirat koirien koirahoitola trimmaamo hoitola koirakoulu elainkauppa elain lemmikki ja",
    is: "hundar hunda hundasnyrting hundaskoli dyr og",
    et: "koer koerte koera trimmisalong koerakool lemmikloomapood loomapood varjupaik ja",
    lv: "suns sunu suni frizetava skola zooveikals patversme dzivnieku un",
    lt: "suo sunu sunys kirpykla mokykla prieglauda zoo gyvunu parduotuve ir",
    cs: "pes psi psu psy salon skola vycvik utulek chovatelske potreby zverimex pro pejsky",
    sk: "pes psi psov salon skola vycvik utulok chovatelske potreby zverimex pre",
    hu: "kutya kutyak kutyakozmetika kutyaiskola kutyapanzio panzio menhely allatmenhely kisallat allateledel es",
    ro: "caine caini catel salon toaletaj canin canina pensiune hotel dresaj adapost magazin animale pentru",
    bg: "куче кучета салон груминг хотел приют зоомагазин зоо",
    mk: "кучиња куче салон хотел азил зоо",
    sr: "pas psi pse psa salon azil hotel пас пси псе салон азил хотел",
    hr: "pas psi pse psa salon azil hotel udruga trgovina",
    sl: "pes psi pse pasji salon zavetisce hotel trgovina",
    el: "σκυλος σκυλοι σκυλων κομμωτηριο pet shop",
    uk: "собака собак собаки грумінг груминг салон притулок зоомагазин",
    sq: "qen qenve sallon pet shop",
    en: "groomers grooming dog dogs puppy pet pets salon spa parlour parlor boarding kennels kennel cattery daycare day care hotel rescue trust centre center supplies store shop training trainer school academy club k9 canine the and for"
  },
  // Boarding and day care: Overture's other categories (pet sitting, dog walking,
  // pet services) count only with one of these words in the name.
  boarding: {
    de: ["tagesstatte", "hundekita", "ferienhof", "ferienheim", "herberge", "hundehotel"],
    fr: ["chenil de garde"], it: ["asilo per cani", "asilo cani", "asilo per il cane"], es: ["residencia"], ca: ["residencia"],
    pt: ["pensao", "alojamento"], da: ["hundepasning", "dagpleje", "hundehotel"], sv: ["dagis"], nb: ["barnehage"],
    fi: ["hoitola", "paivakoti"], is: ["gæsla", "gaesla"], et: ["koerahoid", "koertehoid", "koerte hoid", "lasteaed", "hoiukodu"],
    lv: ["viesnic", "bernudarz", "pansij"], lt: ["viesbut", "darzel"], cs: ["penzion"], sk: ["penzion"], hu: ["panzio", "ovoda", "kutyaovi"],
    ro: ["pensiun", "gradinit"], bg: ["хотел", "пансион"], mk: ["хотел", "пансион"], sr: ["pansion", "smestaj", "smjestaj", "vrtic", "пансион", "смештај", "вртић", "хотел"],
    hr: ["pansion", "smjestaj", "vrtic"], sl: ["varstvo", "penzion"], el: ["ξενοδοχ", "πανσιον", "φιλοξενι"],
    uk: ["готел", "гостиниц", "передерж", "пансіон", "пансион", "хотел"], en: ["=kennels", "=lodge", "pet hotel", "dog hotel"], nl: ["logeren", "logeerhuis"]
  },
  // A word for an animal, so that a word for lodging ("Hotel", "Pensión", "Pension") is
  // about pets: "Hundepension", "Pet Hotel", "Hotel Canino", not "Pensión Sotelo".
  petWord: {
    all: ["dier", "tier", "^animal", "^anima", "^mascot", "zwierz", "^djur", "^dyre", "^elain", "lemmik", "^zvir", "^zvier", "^allat", "kisallat",
      "zivali", "ljubim", "животн", "тварин", "любимц", "κατοικιδ", "=pet", "=pets", "pethotel", "petshotel", "=zoo", "^zoo", "^paw", "^pfot",
      "^patte", "^zampa", "^pata", "^tass", "^lapk", "^lapy", "=lapa", "^labut", "kennel"]
  },
  // Rescues and shelters filed as boarding: left out of boarding.
  rescue: {
    de: ["tierhilfe", "tierasyl", "gnadenhof", "tiernothilfe", "auffangstation"], fr: ["protectrice", "protection animale", "protection des animaux", "association", "adoption"],
    it: ["canile municipale", "canile comunale", "canile sanitario", "canile rifugio", "rifugio", "associazione", "protezione animali", "=enpa", "=lav", "adozion", "=onlus", "=odv"], es: ["protectora", "asociacion", "fundacion", "adopcion", "refugio", "rescate", "perrera"],
    ca: ["protectora", "associacio", "refugi", "adopcio"], pt: ["associacao", "abrigo", "canil municipal", "protecao", "adocao", "resgate"],
    da: ["dyreværn", "dyrevaern", "dyrebeskyttelse", "dyreinternat", "forening"], sv: ["djurskydd", "djurhem", "forening", "stiftelse", "omplacering"],
    nb: ["dyrebeskyttelse", "dyrevern", "forening", "stiftelse", "omplassering"], fi: ["elainsuojelu", "yhdistys", "loytoelain", "elainkoti"],
    is: ["dyrahjalp", "dyravernd"], et: ["varjupaik", "loomakaitse", "=selts", "=mtu", "sihtasutus"], lv: ["patversm", "biedriba", "nodibinajum", "aizsardz"],
    lt: ["prieglaud", "asociacij", "=vsi", "gelbejim"], cs: ["utulek", "=spolek", "nadace", "nadacn", "zachran", "ochrana zvirat", "ochrany zvirat"],
    sk: ["utulok", "zdruzeni", "nadacia", "zachran", "ochrana zvierat", "ochrany zvierat"], hu: ["menhely", "alapitvany", "egyesulet", "allatvedo", "allatmento", "kutyamento"],
    ro: ["adapost", "asociatia", "fundatia", "protectia animalelor", "salvare"], bg: ["приют", "сдружение", "фондация", "спасяване"],
    mk: ["засолниште", "здружение", "фондација", "азил"], sr: ["=azil", "prihvatil", "udruzenje", "удружење", "fondacija", "skloniste", "азил", "прихватил"],
    hr: ["=azil", "prihvatil", "udruga", "zaklada", "skloniste"], sl: ["zavetisc", "drustvo", "=zavod"], el: ["καταφυγ", "φιλοζωικ", "σωματει", "διασωσ"],
    uk: ["притул", "приют", "=фонд", "благодійн", "благотвор", "порятун", "спасени"], sq: ["streh", "shoqata", "fondacion", "shpetim"],
    en: ["sanctuary", "charity", "rehoming", "=trust", "=rspca", "=spca", "shelter", "adoption", "=society"]
  },
  // Dog trainers: a training word keeps a place that also has a word below (NOT).
  training: {
    de: ["schule", "erzieh", "ausbild", "verein", "dressur", "obedien", "mantrail", "rettungshund", "begleithund"],
    fr: ["ecole", "educat", "educa", "dressage", "comportement"], it: ["scuola", "addestra", "educa", "cinofil", "comportament"],
    es: ["escuela", "adiestra", "educa", "etolog", "comportamiento"], ca: ["escola", "ensinistra", "educa"], pt: ["escola", "treino", "adestra", "educa", "comportament"],
    da: ["skole", "træn", "traen", "lydighed", "dressur"], sv: ["skola", "traning", "dressyr", "lydnad"], nb: ["skole", "lydighet", "dressur"],
    fi: ["koulu", "valmennus", "seura", "kerho"], is: ["skoli", "þjalf", "thjalf"], et: ["=kool", "koerakool", "koolitus", "treen", "klubi"],
    lv: ["skola", "apmacib", "dresur", "trenin"], lt: ["mokykl", "dresav", "dresuot", "treniruot", "kinolog"],
    cs: ["skola", "vycvik", "vychova"], sk: ["skola", "vycvik", "vychova"], hu: ["iskola", "kikepz", "nevel", "oktat", "egyesulet"],
    ro: ["scoala", "dresaj", "dresor", "antren", "educati", "kinolog", "chinolog"], bg: ["школа", "обучение", "дресир", "дресьор", "кинолог"],
    mk: ["школа", "обука", "дресура", "кинолог"], sr: ["skola", "dresur", "obuka", "kinolog", "обука", "школа", "дресур", "кинолог"],
    hr: ["skola", "dresur", "obuka", "kinolog"], sl: ["sola", "solanje", "vzgoj", "dresur", "kinolo"], el: ["εκπαιδευ", "σχολ"],
    uk: ["школа", "дресир", "кінолог", "кинолог", "навчан", "тренув", "тренер", "обучен"], sq: ["shkoll", "trajnim", "stervit"],
    en: ["obedien", "=class", "=classes", "=k9"]
  },
  // Not a trainer (unless a training word says so): walkers, groomers, sitters,
  // breeders, masseurs and physiotherapists that Overture files as dog trainers.
  notTraining: {
    de: ["gassi", "zuchter", "=zucht", "zwinger", "physio", "friseur", "betreuung", "hundesalon"], fr: ["promen", "toilett", "elevage", "eleveur", "garde", "osteo", "physio"],
    it: ["toelett", "allevament", "fisio", "passeggiat"], es: ["paseador", "paseo", "peluquer", "criadero", "criador", "residencia", "fisio", "cuidador"],
    ca: ["passeig", "perruquer", "criador"], pt: ["passeio", "passead", "tosquia", "banho", "criador", "=canil"],
    da: ["luftning", "lufter", "frisør", "frisor", "opdræt", "opdraet", "pasning"], sv: ["promenad", "rastn", "frisor", "uppfodare"],
    nb: ["lufting", "luftetur", "frisør", "frisor", "oppdrett"], fi: ["ulkoilut", "trimm", "kasvattaj", "hieronta", "hoitola"],
    et: ["jalutus", "trimm", "kasvandus"], lv: ["pastaig", "frizet", "audzetav"], lt: ["vedzioj", "kirpykl", "veislyn"],
    cs: ["vencen", "strih", "chovatel", "hlidan", "masaz", "fyzio"], sk: ["vencen", "strihan", "chovatel", "fyzio", "masaz"],
    hu: ["setaltat", "kozmetik", "tenyesz", "panzio", "masszazs"], ro: ["plimbar", "toaletaj", "canisa", "crescator"],
    bg: ["разходк", "груминг", "развъдник"], mk: ["одгледувачн", "шетањ"], sr: ["setanj", "setac", "sisanj", "uzgajiv", "odgajiv", "шетањ", "узгајив", "одгајив"],
    hr: ["setanj", "setac", "sisanj", "uzgajiv"], sl: ["sprehaj", "vzrej", "frizer"], el: ["βολτ", "κομμωτ", "κουρει", "εκτροφ"],
    uk: ["вигул", "грумін", "грумин", "розплідн", "питомник", "стрижк", "передерж"], sq: ["shetit", "qethje"], en: ["breeder"]
  },
  // Shelters: a word for a shelter in the name (and a website that confirms it).
  shelter: {
    de: ["asyl", "tierhaus"], fr: ["fourriere", "=spa"], es: ["refugio", "protectora", "perrera", "albergue", "proteccion animal"],
    it: ["canile", "rifugio"], pt: ["abrigo", "=canil", "recolha"], ca: ["refugi", "protectora", "gosser", "acollida"],
    da: ["dyreinternat", "hundeinternat", "dyrehjem", "hundehjem"], sv: ["djurhem", "hundhem"], nb: ["dyrehjem", "hundehjem"],
    fi: ["loytoelain", "elainkoti", "elainsuojakoti", "kodittom"], is: ["athvarf"], et: ["varjupaik"], lv: ["patversm"], lt: ["prieglaud"],
    cs: ["utulek", "utulk", "zachytn", "depozit"], sk: ["utulok", "karanten"], hu: ["menhely", "allatotthon", "ebrendesz", "gyepmester", "kutyaotthon"],
    ro: ["adapost", "=azil"], bg: ["приют"], mk: ["прифатилишт", "азил", "засолништ"], sr: ["=azil", "prihvatil", "sklonist", "азил", "прихватилиш", "склониш"],
    hr: ["=azil", "prihvatil", "sklonist"], sl: ["zavetisc"], el: ["καταφυγ"], uk: ["притул", "приют"], sq: ["streh"],
    en: ["dogs home", "dog home", "dogs' home", "dog's home", "rehoming", "rescue cent", "animal cent", "dog pound"]
  },
  // Pet shops: a word for a pet shop in the name or the web address.
  shop: {
    de: ["zoohandlung", "zoofach", "tierbedarf", "tiershop", "futterhandel", "heimtier", "zoogeschaft", "zoomarkt", "futterhaus", "futterkiste", "gartencent", "=zoo"],
    fr: ["animalerie", "jardinerie", "aliments pour animaux", "aliment animal"], it: ["negozio", "articoli per animali", "=animali", "mangim", "zoomarket"],
    es: ["tienda de animales", "tienda animal", "mascota", "tiendanimal"], ca: ["botiga"], pt: ["loja", "racoes", "racao", "=animais"],
    da: ["dyrehandel", "dyrefoder", "foderbutik", "dyrecenter", "dyrebutik"], sv: ["djuraffar", "djurbutik", "djurfoder", "djurmagas", "djurmagaz"],
    nb: ["dyrebutik", "foring", "dyreland"], fi: ["elainkauppa", "lemmikki", "elaintarvik", "musti ja mirri"], is: ["gæludyr", "gaeludyr", "dyrabuð"],
    et: ["lemmikloom", "loomapood", "zoopood", "=pood", "kauplus"], lv: ["zooveikal", "veikals", "dzivnieku prec"], lt: ["gyvunu prek", "zoo prek", "parduotuv"],
    cs: ["chovatelsk", "zverimex", "potreby pro zvirata"], sk: ["chovatelsk", "zverimex", "potreby pre zvierat"],
    hu: ["allateledel", "kisallat", "diszallat", "allatkereskedes", "allatfelszer", "allatbolt", "kutyabolt"],
    ro: ["magazin", "hrana pentru animale"], bg: ["зоомагазин", "=зоо", "зоомаркет", "храни за животни"], mk: ["=зоо", "пет шоп", "зоомаркет"],
    sr: ["ljubim", "љубим", "=зоо", "зоо маркет", "pet cent"], hr: ["ljubim", "pet cent"], sl: ["trgovina", "male zivali", "ljubljenc"],
    el: ["κατοικιδι", "ζωοτροφ", "pet market"], uk: ["зоомагазин", "зоотовар", "зоомаркет", "=зоо"], sq: ["kafsh"],
    en: ["pet suppl", "pet cent", "pet superstore", "pet supermarket", "pets corner", "pets at home", "jollyes", "pet mart", "petmart", "garden cent"]
  },
  // A strong shop word: kept even with a web address in the name ("Zoohandlung tierwelt.de").
  strongShop: {
    de: ["zoohandlung", "zoofachhandel", "tierbedarf"], fr: ["animalerie"], cs: ["chovatelske potreby", "zverimex"], sk: ["chovatelske potreby", "zverimex"],
    sv: ["djuraffar"], da: ["dyrehandel"], fi: ["elainkauppa"], bg: ["зоомагазин"], uk: ["зоомагазин"], en: ["pet shop", "pet store"]
  },
  // A webshop by name: left out.
  online: {
    de: ["versand", "onlineshop"], fr: ["en ligne"], fi: ["verkkokauppa"], da: ["nettbutik", "netbutik", "webbutik"], nb: ["nettbutikk"], sv: ["webbutik", "nätbutik", "natbutik"],
    cs: ["e-obchod", "eobchod", "internetov"], sk: ["internetov"], hu: ["webaruhaz", "webshop"], sl: ["spletna trgovina"], hr: ["internetska"], ro: ["magazin online"],
    bg: ["онлайн", "интернет"], uk: ["онлайн", "інтернет", "интернет"], en: ["=internet", "web only", "online only"], nl: ["webwinkel"]
  },
  // Shops for other animals (fishing, aquaria, riding, pigeons), as the start of a word.
  shopOther: {
    de: ["angelsport", "angelshop", "angelbedarf", "angler", "reitsport", "reiter", "sattler", "pferdesport", "taube", "teich"],
    fr: ["peche", "equitation", "sellerie", "colombophil", "oiseau"], es: ["pesca", "hipic", "equitac", "acuar", "pajar", "colombof"],
    it: ["pesca", "equitazion", "selleria", "acquar", "uccell", "ornitolog", "colombofil"], pt: ["pesca", "equita", "columbof"],
    ca: ["pesca", "hipica"], da: ["fiske", "akvari", "rideudstyr"], nb: ["fiske", "akvari", "rideutstyr"], sv: ["fiske", "akvari", "ridsport", "fagel"],
    fi: ["kalastus", "akvaar", "ratsast", "lintu"], is: ["veiði", "veidi", "fiska"], et: ["kalastus", "akvaar", "ratsa"], lv: ["makske", "akvarij"],
    lt: ["zvejyb", "akvar", "jojim"], cs: ["rybar", "akvar", "jezdeck"], sk: ["rybar", "akvar", "jazdeck"],
    hu: ["horgasz", "akvar", "lovasbolt", "lovassport", "lovasfelszer", "diszhal"], ro: ["pescuit", "pescar", "acvar", "ecvestr", "porumb"], bg: ["риболов", "аквари", "рибк"],
    mk: ["риболов", "аквари"], sr: ["ribolov", "ribic", "akvari", "konjick", "рибол", "аквар"], hr: ["ribolov", "ribic", "akvari", "konjick"],
    sl: ["ribis", "akvar", "konjen"], el: ["αλιε", "ψαρεμ", "ενυδρει", "ιππασ"], uk: ["рибол", "рибалк", "аквар"], sq: ["peshk"],
    en: ["angling", "tackle", "fishing", "pond", "pigeon"]
  },
  // A word for a pet shop (the shop also sells fishing gear, or has a cat in its name).
  petShop: {
    de: ["^tier", "^zoo", "^futter"], fr: ["^animal", "^animaux"], it: ["^animal"], es: ["^animal", "^mascot"], pt: ["^anima"], da: ["^dyr"], sv: ["^djur"], nb: ["^dyr"],
    fi: ["^elain", "^lemmik"], et: ["^lemmik", "^loom"], lv: ["^dzivniek"], lt: ["^gyvun"], cs: ["^zvir", "chovatelsk"], sk: ["^zvier", "chovatelsk"],
    hu: ["^allat", "^kisallat"], ro: ["^animal"], bg: ["^зоо", "^животн"], uk: ["^зоо"], en: ["^pet"]
  },
  // Places for other animals only (wildlife, birds, hedgehogs, horses), as the start
  // of a word: added to lib/classify.js otherAnimalsOnly, also in Cyrillic and Greek.
  otherAnimals: {
    de: ["igel", "wildtier", "wildvogel", "vogelschutz", "vogelhilfe", "pferdeschutz", "eichhornchen"], fr: ["herisson", "faune", "oiseau", "sauvage"],
    it: ["selvatic", "faunistic", "uccell", "avifauna"], es: ["erizo", "silvestre"], pt: ["ourico", "selvagem"],
    da: ["vildt", "fugle", "pindsvin"], sv: ["vilt", "fagel", "igelkott"], nb: ["vilt", "fugle", "pinnsvin"], fi: ["villielain", "lintu", "siili"],
    cs: ["zachranna stanice", "ptac"], sk: ["vtac"], hu: ["vadmento", "madar"], ro: ["salbatic", "pasari"],
    hr: ["ptic", "jezev"], sl: ["ptic"], bg: ["котк", "коне", "птиц", "диви"], mk: ["мачк", "коњ", "птиц"], sr: ["мачк", "коњ", "птиц"],
    el: ["γατ", "αλογ", "πουλι", "πτην", "αγρι"], uk: ["кіт", "котів", "котик", "кіш", "кош", "конн", "кінн", "птах", "птиц"], en: ["hedgehog", "swan", "owl", "wildlife", "equine", "donkey", "guinea pig", "ferret", "tortoise"]
  },
  // The website check (tools/overture.js pageVerdict): "dog" in more languages.
  dogPage: {
    prefix: ["caini", "pejsk", "cachorr", "canin", "kelb", "klieb", "suniem", "sunim", "sunys", "собач", "кучиња", "кучет", "песик", "цуцен"],
    whole: ["psi", "psu", "suns", "sunus", "gos", "пса", "псе", "пси", "пас"]
  }
};
