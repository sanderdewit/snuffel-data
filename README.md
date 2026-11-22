# 🐾 snuffel-data

Open data pipeline behind [Snuffel](https://snuffel.app), a directory that helps
dog owners across Europe 🇪🇺 (45 countries, see [`tools/countries.json`](tools/countries.json))
find **independent** vets, emergency vets, groomers, shops, trainers, dog hotels and
dog play areas.

This repository collects and publishes the data; the site itself lives elsewhere.
Everything runs on GitHub Actions and writes static files to Azure Storage:

| Workflow | When | Output |
|---|---|---|
| [`data`](.github/workflows/data.yml) | monthly (3rd), or manually | `places/manifest.json` + 0.25° cells, `chains.json`; commits the [vet register](#vet-register) |
| [`tiles`](.github/workflows/tiles.yml) | quarterly, or manually | `tiles/snuffel.pmtiles` (Protomaps basemap) |
| [`breeds`](.github/workflows/breeds.yml) | monthly (5th), or manually | a pull request when the breed list changed |
| [`test`](.github/workflows/test.yml) | every push / PR | unit tests |

## Places

`tools/build-places.js` reads [Geofabrik](https://download.geofabrik.de/) country
extracts (filtered with `osmium`) and keeps every vet, animal hospital, pet shop,
groomer, boarding kennel, dog trainer, shelter, dog park and off-leash area, plus
parks whose name marks them as a dog field (hondenweide, Hundewiese, caniparc,
wybieg dla psów, psí louka). Classification rules: [`lib/classify.js`](lib/classify.js).
Grooming salons OpenStreetMap lacks come from Overture Maps (below).

## Independent or chain-owned?

Acquired practices usually keep their own name, so a name tells you little.
[`lib/chains.js`](lib/chains.js) combines evidence, strongest first:

1. **Manual review** — [`tools/chain-overrides.json`](tools/chain-overrides.json)
2. **The groups' own clinic lists** — every clinic page of AniCura (13 countries),
   VetPartners, Medivet, CVS, Linnaeus, Vets for Pets, Sevetys, Mon Véto, Univet,
   Argos, Kivet, Tierarzt Plus Partner, Vetopia (AT), VetTrust, Animalia and
   Ca' Zampa, matched on phone number and on the clinic's own website where the
   group links it; Evidensia Belgium's practice list, matched on website
3. **The clinic's own website** — it redirects to a group domain, names the group
   as legal entity or in its copyright line, says it is *part of* a group, or links
   to the group's own terms / privacy pages ([`tools/scan-websites.js`](tools/scan-websites.js))
4. **OpenStreetMap tags** — name / brand / operator, or a `brand:wikidata` chain tag

Merely **mentioning** a group is never enough: independent clinics routinely send
out-of-hours emergencies to a chain hospital. Those cases are kept for human
review only. [`tests/scan.test.js`](tests/scan.test.js) pins real examples.

Crawling is polite: `robots.txt` is honoured (evidensia.de and evidensia.pl are
therefore not crawled), one request per site at a time, ~1 request/s for the
groups' own sites.

### Groups we recognise (ownership as researched October 2026)

| Group | Owner | Main countries |
|---|---|---|
| AniCura | Mars, Inc. | most of Europe |
| IVC Evidensia (incl. Caressa) | EQT (private equity) | most of Europe |
| Linnaeus | Mars, Inc. | UK |
| VetPartners (DierenDokters, Swissvet, Vetersalud…) | BC Partners (PE) | UK, ES, FR, IT, NL, IE, DE, PT, CH |
| Medivet | CVC Capital Partners (PE) | UK, DE, ES |
| CVS Group | listed (LSE) | UK |
| Pets at Home Vet Group (Vets for Pets, Companion Care) | Pets at Home plc (listed) | UK |
| Sevetys | Eurazeo (PE) with vet partners | FR |
| Mon Véto | vet-owned majority, Ardian (PE) minority | FR, BE |
| Univet | InfraVia (PE) | FR, BE |
| Argos Vétérinaire | G Square (PE) | FR |
| UNAVETS | Oaktree Capital (PE) | ES, PT |
| Kivet / Clinicanimal | Iskaypet (pet retail) | ES, PT |
| Tierarzt Plus Partner | Inflexion (PE) | DE |
| Vetopia (VetGruppen, Empet, Svenska Veterinärgruppen, Helvetiera, Veterinaria, Vireä) | Axcel (PE) with employees | DK, NO, SE, CH, AT, FI, DE, UK |
| VetTrust | Porterhouse Group (family office) | CH |
| Gruppo Animalia | Charme Capital (PE) | IT |
| Ca' Zampa / BluVet | Nextalia (PE; disputed) | IT |
| LuxVet | INVL Baltic Sea Growth Fund (PE) | PL |

Group names that are also ordinary words or street names (Linnaeus, Argos,
Kivet, Univet, Animalia, Medivet) are matched by website domain only.

**Something wrong?** Open an issue with the clinic and a source; corrections go
into `tools/chain-overrides.json` and are live after the next data run.

## Opening hours from the clinics' own websites

About a third of the vets in OpenStreetMap have no `opening_hours`, so an
emergency search can't tell "closed" from "unknown". For vets **without** hours
that do have a website, [`tools/scan-hours.js`](tools/scan-hours.js) reads up to
three pages of that site (robots.txt honoured) and takes:

1. **structured data** (schema.org `openingHoursSpecification` / `openingHours`)
   when the site has it;
2. otherwise the text around "openingstijden", "spreekuur", weekday names… goes to
   a small Azure OpenAI model that answers in OSM `opening_hours` syntax or null;
3. **emergency information**: 24/7 emergency care at the clinic itself, or an
   out-of-hours line to the on-call vet.

Every answer must pass a strict grammar check (only plain weekday/time rules)
or it is dropped. Unchanged pages reuse last month's answer, so the AI only sees
changes. The results are published as `hours.json`, kept in the
[vet register](#vet-register), and added to the places as
separate `snuffel:opening_hours` / `snuffel:emergency` fields: OpenStreetMap's own
hours always win, and the site and app label these as "according to their own
website". Nothing is written to OpenStreetMap automatically; each place links to
the OSM editor so people can correct the source. Countries: the
`HOURS_COUNTRIES` variable (default `nl be`).

## Vet register

Only about a fifth of the vets in OpenStreetMap have a website there, and a site
that can't be read one month used to lose the hours found the month before. So
we keep our own register: [`vets/<cc>.jsonl`](vets/), one JSON line per vet in
OpenStreetMap, sorted by OSM id, with its website and opening hours and where each
came from (fields: the header of [`tools/vets.js`](tools/vets.js)). Countries: the
`VETS_COUNTRIES` variable (default `nl be`).

Sources, in order of trust:

1. **a hand fix** in [`vets/overrides.json`](vets/overrides.json);
2. **OpenStreetMap's own** `website` / `opening_hours`;
3. **the clinic's own website**, read by `tools/scan-hours.js` (above);
4. **a branch of the same practice**, for a vet without a website: the same phone
   number, a shared distinctive name and within 40 km, and only when every such
   branch has the same website (Mark Dierenarts in Utrecht gets the site of Mark
   dierenarts in Vleuten; a group number with one page per clinic gives nothing).
   On a branch's site only hours for the vet's own address count.

Hours read from a website stay until a scan says otherwise, or until no scan has
confirmed them for 180 days. A vet gone from OpenStreetMap is kept 90 days, and
picked up again if it comes back under a new id within 150 m with the same name
or phone number. The monthly data run updates the register before the website
scan (`node tools/vets.js update <cc>`), takes in the scan's answers after it
(`node tools/vets.js hours <cc>`) and, once the data is published, commits the
changed files straight to `main` with a summary, so the history shows every
change. The places get our values as separate `snuffel:website` /
`snuffel:opening_hours` / `snuffel:emergency` fields; OpenStreetMap's own values
are never hidden.

**Hand fix:** add the vet under its OSM id to `vets/overrides.json`, with `site`
and/or `hours` (plain OSM syntax), always a `note` (who checked what, and how) and,
for hours, the date they were `checked`:

```json
"n123": { "hours": "Mo-Fr 08:00-18:00; Sa 09:00-12:00", "checked": "2026-11-21", "note": "phoned the clinic" }
```

`node tools/vets.js check` validates it; it takes effect at the next data run, and
removing it makes the next run go back to the other sources. Where OpenStreetMap
itself is wrong, please fix it there too. A country taken out of `VETS_COUNTRIES`
should also lose its file: a register file that stays is still used.

The register is derived from OpenStreetMap data and therefore available under the
ODbL 1.0 (© OpenStreetMap contributors), plus facts the clinics publish themselves
(their website and opening hours).

## Places from Overture Maps

OpenStreetMap has about 100 of the Netherlands' thousands of dog grooming salons.
[Overture Maps](https://overturemaps.org) (open data from business registers and
public business pages) has most of them, with closed and stale ones among them.
[`overture/<cc>.jsonl`](overture/) lists the ones we publish, one JSON line per
place (fields: the header of [`tools/overture.js`](tools/overture.js)). Countries:
the `OVERTURE_COUNTRIES` variable (default `nl`); category: grooming salons.

Each data run, `python3 tools/overture.py <cc>` reads the newest Overture release
straight from its public files (DuckDB) and `node tools/overture.js update <cc>`
decides, against that run's OpenStreetMap places:

- **OpenStreetMap wins:** a candidate within 150 m of an OSM place with a name
  word in common (or within 25 m) is left out, so nothing appears twice. Overture's
  own duplicates (same name within 150 m) are merged, and closed places are skipped.
- **With a website:** published when the home page answers and is about dogs or
  grooming (robots.txt honoured, no AI), kept while a later run can't reach it for
  up to 180 days after the last confirmation. Dead, parked or unrelated sites keep a
  new place out.
- **Without a website** (or one robots.txt keeps us out of): published when
  Overture's own confidence is at least 0.77.

Many salons are run from home: the checks above keep old registrations at private
addresses out. The places get `snuffel:source` `overture` and the date of the last
check in `snuffel:checked`. A place that is wrong is best fixed by adding it to
OpenStreetMap: from the next run the OSM entry is used instead.

Measured for the Netherlands in November 2026 (Overture 2026-11-18.0 against our
published data); "usable" are places we don't have that pass the checks above:

| Overture category | Overture | already ours | usable | ours (OSM) |
|---|---|---|---|---|
| grooming salons (taken) | 3,623 | 140 | ~2,050 | 98 |
| dog trainers | 1,830 | 53 | ~1,270 | 54 |
| pet shops | 3,153 | 663 | ~1,240 | 760 |
| vets | 2,412 | 771 | ~1,230 | 709 |
| shelters and rescues | 744 | 71 | ~330 | 112 |
| boarding | 413 | 17 | ~250 | 83 |
| animal hospitals | 116 | 32 | ~50 | 25 |
| dog parks | 356 | 30 | ~50 | 2,011 |

Vets and animal hospitals are not taken: people use them in emergencies, and
Overture's extra vets include ambulant vets registered at home, farm and horse
vets and moved practices. Missing vets go through the vet register and
`tools/extra-places.json` instead, checked by hand.

## Search groups for lost dogs

[`lost/groups.json`](lost/groups.json) lists local search groups (often Facebook groups)
that the lost-dog guide on the site and in the app shows under the official registers:
public, recently active, not commercial, checked by hand. Suggestions come in through the
[issue form](../../issues/new?template=lost-group.yml); `node tools/lost-groups.js check`
validates the list, and the [`lost-groups`](.github/workflows/lost-groups.yml) workflow
publishes it as `snuffel.app/data/lost-groups.json` on every change.

## Dog breeds

[`breeds/breeds.json`](breeds/breeds.json) is the breed list of the app's breed picker:
every breed of the [FCI nomenclature](https://www.fci.be/en/Nomenclature/) (definitive
and provisional), FCI varieties worth picking on their own (Malinois, Pomeranian,
toy poodle...), common crosses (Labradoodle, Cockapoo, Cavapoo...), breeds the FCI
doesn't recognise but that are common in Europe (American Bully, Podenco Andaluz,
Markiesje...), "mixed breed" and "other". Every entry has a stable id (`fci-166`,
`fci-15-malinois`, `x-labradoodle`, `nf-american-bully`, `mixed`, `other`), a name in
all 29 languages and search terms (other names, local names, common misspellings).

[`tools/build-breeds.js`](tools/build-breeds.js) builds it from the FCI's group pages
(numbers, names, groups: facts only), [Wikidata](https://www.wikidata.org) (names and
aliases, CC0) and the [Raad van Beheer](https://www.houdenvanhonden.nl/hondenrassen/alle-rassen/)
(the official Dutch names), plus the hand-kept [`breeds/overrides.json`](breeds/overrides.json).
A language without its own name for a breed gets the name of a close language or the
English one. The monthly [`breeds`](.github/workflows/breeds.yml) workflow rebuilds it and
opens a pull request with a summary when anything changed; ids that disappear stay,
marked `removed`.

## Shared core

`lib/` (chain detection, category rules, opening hours), `i18n/` (29 language
packs) and `breeds/breeds.json` (the app only) are the single source for the website and the
[Snuffel app](https://github.com/sanderdewit/snuffel-app). Both keep identical
copies; their CI fails when a copy differs from this repository.

## Map tiles

`tools/tiles-region.js` builds the outline of the countries in `tools/countries.json`
([Natural Earth](https://www.naturalearthdata.com/), public domain);
the `tiles` workflow cuts that region out of the latest
[Protomaps](https://protomaps.com) planet build with `pmtiles extract`.

## Running locally

```bash
node tests/places.test.js && node tests/chains.test.js && node tests/scan.test.js
node tools/build-chains.js                 # official lists -> dist/chains.json
node tools/scan-websites.js nl             # needs tools/.cache/osm-vets-nl.json (from build-places add, or Overpass)
node tools/evaluate-chains.js nl           # what is flagged, and by which signal
node tools/vets.js update nl               # vet register vets/nl.jsonl from tools/.cache/osm-vets-nl.json
node tools/scan-hours.js nl                # opening hours from clinic websites -> tools/hours-nl.json
node tools/vets.js hours nl                # ... into the register; `node tools/vets.js check` validates it
node tools/build-breeds.js --cache         # breed list -> breeds/breeds.json (downloads kept in tools/.cache/breeds)
```

## Credentials

The `data` and `tiles` workflows need:

- variable `AZURE_STORAGE_ACCOUNT` — the storage account name
- variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — the
  Entra app "snuffel-data-publish". Workflows sign in with GitHub OIDC (no stored
  key or SAS): its federated credential only trusts this repo's `publish`
  environment (main branch only), and its only role is Storage Blob Data
  Contributor on the `data` and `tiles` containers.
- secrets `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY` and variable
  `AZURE_OPENAI_DEPLOYMENT` — for the opening-hours step (without them only
  structured data is used)

Workflows run only on schedule or manual dispatch, never on pull requests from
forks, so secrets are not exposed.

## Licence

- Places and derived data: © OpenStreetMap contributors, available under the
  [Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright).
- Vet register (`vets/`): derived from OpenStreetMap (ODbL 1.0), plus websites and
  opening hours published by the clinics themselves.
- Places from Overture Maps (`overture/`, and those places in the published data):
  © Overture Maps Foundation, under the
  [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/); the few places Overture
  has from Foursquare are under the Apache-2.0 licence.
- Basemap: [Protomaps](https://protomaps.com) (BSD 3-Clause / ODbL).
- Country outlines: Natural Earth (public domain).
- Breed names: Wikidata (CC0); breed numbers and groups: the FCI nomenclature (fci.be);
  Dutch names: Raad van Beheer.
- Code, language packs, the lost-dog guide and documentation: © De Wit Automatisering B.V.,
  all rights reserved unless stated otherwise (public to read, not a licence to reuse).
  See [LICENSE](LICENSE).
