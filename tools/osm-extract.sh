#!/usr/bin/env bash
# The OpenStreetMap extract for one country, for the data workflow:
#   tools/osm-extract.sh <geofabrik path> "<openstreetmap.fr paths>" <out.osm.pbf>
# Paths as in tools/countries.json ("geofabrik", "osmfr"; several osmfr paths are
# merged into one extract, e.g. Guernsey and Jersey). Exit 0 with the extract at
# <out>, exit 3 when neither source could be downloaded.
#
# Geofabrik refuses connections from some GitHub runners, and a refusal does not
# pass while the job runs (24 Nov 2026: 6 of 45 runners, every one of 21 tries in
# 30 minutes failed; on a re-run 2 of 4 again). So Geofabrik gets a few tries
# only, then openstreetmap.fr where it has the country. A stalled download
# (under 100 kB/s for 3 minutes) counts as a failed try.
set -uo pipefail
geofabrik=$1 osmfr=$2 out=$3
delay=${OSM_RETRY_DELAY:-60}   # seconds between tries (tests use 1)

get() { curl -fsSL --connect-timeout 30 --speed-limit 100000 --speed-time 180 --retry-all-errors "$@"; }

get --retry 5 --retry-delay "$delay" -o "$out" "https://download.geofabrik.de/$geofabrik-latest.osm.pbf" && exit 0
rm -f "$out"
if [ -z "$osmfr" ]; then
  echo "::warning::Geofabrik failed for $geofabrik, and openstreetmap.fr has no extract for it"
  exit 3
fi
echo "::warning::Geofabrik failed for $geofabrik - trying openstreetmap.fr ($osmfr)"
parts=()
for p in $osmfr; do
  part="$out.$(basename "$p").osm.pbf"
  get --retry 5 --retry-delay "$delay" -o "$part" "https://download.openstreetmap.fr/extracts/$p-latest.osm.pbf" \
    || { echo "::warning::openstreetmap.fr failed for $p"; rm -f "${parts[@]}" "$part"; exit 3; }
  parts+=("$part")
done
if [ ${#parts[@]} -eq 1 ]; then
  mv "${parts[0]}" "$out"
else
  osmium merge "${parts[@]}" -o "$out" --overwrite || exit 1
  rm -f "${parts[@]}"
fi
