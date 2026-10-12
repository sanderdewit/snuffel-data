# 🐾 snuffel-data

Open data pipeline behind [Snuffel](https://wonderful-island-0c49a0103.7.azurestaticapps.net),
a directory that helps dog owners in 🇳🇱 🇧🇪 🇫🇷 🇩🇪 🇵🇱 🇨🇿 find **independent** vets, groomers,
shops, trainers, dog hotels and dog play areas.

This repository collects and publishes the data; the site itself lives elsewhere.
Everything runs on GitHub Actions and writes static files to Azure Storage:

| Workflow | When | Output |
|---|---|---|
| [`data`](.github/workflows/data.yml) | monthly (3rd), or manually | `places/manifest.json` + 0.25° cells, `chains.json` |
| [`tiles`](.github/workflows/tiles.yml) | quarterly, or manually | `tiles/snuffel.pmtiles` (Protomaps basemap) |
| [`test`](.github/workflows/test.yml) | every push / PR | unit tests |

## Places

`tools/build-places.js` reads [Geofabrik](https://download.geofabrik.de/) country
extracts (filtered with `osmium`) and keeps every vet, animal hospital, pet shop,
groomer, boarding kennel, dog trainer, shelter, dog park and off-leash area, plus
parks whose name marks them as a dog field (hondenweide, Hundewiese, caniparc,
wybieg dla psów, psí louka). Classification rules: [`lib/classify.js`](lib/classify.js).

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
changes. The results are published as `hours.json` and added to the places as
separate `snuffel:opening_hours` / `snuffel:emergency` fields: OpenStreetMap's own
hours always win, and the site and app label these as "according to their own
website". Nothing is written to OpenStreetMap automatically; each place links to
the OSM editor so people can correct the source. Countries: the
`HOURS_COUNTRIES` variable (default `nl`).

## Shared core

`lib/` (chain detection, category rules, opening hours) and `i18n/` (29 language
packs) are the single source for the website and the
[Snuffel app](https://github.com/sanderdewit/snuffel-app). Both keep identical
copies; their CI fails when a copy differs from this repository.

## Map tiles

`tools/tiles-region.js` builds the outline of the six countries
([Natural Earth](https://www.naturalearthdata.com/), public domain);
the `tiles` workflow cuts that region out of the latest
[Protomaps](https://protomaps.com) planet build with `pmtiles extract`.

## Running locally

```bash
node tests/places.test.js && node tests/chains.test.js && node tests/scan.test.js
node tools/build-chains.js                 # official lists -> dist/chains.json
node tools/scan-websites.js nl             # needs tools/.cache/osm-vets-nl.json (from build-places add, or Overpass)
node tools/evaluate-chains.js nl           # what is flagged, and by which signal
node tools/scan-hours.js nl                # opening hours from clinic websites -> tools/hours-nl.json
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
- Basemap: [Protomaps](https://protomaps.com) (BSD 3-Clause / ODbL).
- Country outlines: Natural Earth (public domain).
- Code: © Sander de Wit, all rights reserved unless stated otherwise.
