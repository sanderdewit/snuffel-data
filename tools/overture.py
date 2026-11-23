#!/usr/bin/env python3
"""Snuffel - candidate places from Overture Maps (https://overturemaps.org)

    python3 tools/overture.py <cc>

Reads the newest Overture Maps places release straight from its public bucket
(GeoParquet, read with DuckDB; nothing is kept but the result) and writes
tools/.cache/overture-<cc>.jsonl: one line per place in country <cc> whose
Overture category we take (CATEGORIES) and that Overture does not mark as
permanently closed. tools/overture.js decides which of them are published.

The search box is the extent of this run's OpenStreetMap places for <cc>
(dist/stage/<cc>.json, written by tools/build-places.js add), so DuckDB only
reads the row groups around the country. OVERTURE_RELEASE pins a release
("2026-11-18.0"); by default the newest one is used.

Licence: Overture places are CDLA-Permissive-2.0 (a few Apache-2.0), see
overture/README.md.
"""
import json
import os
import re
import sys
import urllib.request

import duckdb

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
# Overture's category (taxonomy.primary) -> ours. Day care and boarding is spread over
# several of Overture's categories: pet_boarding is taken as it is, the others only
# with a boarding word in the name (tools/overture.js). The other categories were
# measured (README, "Places from Overture Maps") but not taken yet.
CATEGORIES = {"pet_groomer": "grooming", "pet_boarding": "boarding", "pet_sitting": "boarding",
              "dog_walker": "boarding", "animal_or_pet_service": "boarding", "pet_care_service": "boarding"}
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DIST = os.environ.get("SNUFFEL_DIST") or os.path.join(ROOT, "dist")
CACHE = os.environ.get("SNUFFEL_CACHE") or os.path.join(ROOT, "tools", ".cache")


def newest_release():
    with urllib.request.urlopen(f"{BUCKET}/?list-type=2&prefix=release/&delimiter=/", timeout=60) as r:
        body = r.read().decode("utf-8")
    releases = re.findall(r"<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>", body)
    if not releases:
        raise SystemExit("no Overture release found in the bucket listing")
    return max(releases, key=lambda v: (v.split(".")[0], int(v.split(".")[1])))


def country_box(cc):
    """The extent of this run's OpenStreetMap places in the country, 0.05 degrees wider."""
    with open(os.path.join(DIST, "stage", f"{cc}.json"), encoding="utf-8") as f:
        places = json.load(f)
    if not places:
        raise SystemExit(f"{cc}: no OpenStreetMap places staged, so no search box")
    lats = [p["lat"] for p in places]
    lons = [p["lon"] for p in places]
    return min(lons) - 0.05, max(lons) + 0.05, min(lats) - 0.05, max(lats) + 0.05


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"[a-z]{2}", sys.argv[1]):
        raise SystemExit("usage: overture.py <cc>")
    cc = sys.argv[1]
    release = os.environ.get("OVERTURE_RELEASE") or newest_release()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", release):
        raise SystemExit(f"not a release: {release}")
    west, east, south, north = country_box(cc)
    con = duckdb.connect()
    con.execute("SET s3_region='us-west-2'")   # public bucket, read without credentials
    src = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    cats = list(CATEGORIES)
    rows = con.execute(f"""
        SELECT id, names."primary", taxonomy."primary", confidence, websites, phones,
               addresses[1].freeform, addresses[1].postcode, addresses[1].locality,
               (bbox.ymin + bbox.ymax) / 2, (bbox.xmin + bbox.xmax) / 2,
               list_distinct(list_transform(sources, lambda s: s.dataset))
        FROM read_parquet('{src}', hive_partitioning = 1)
        WHERE bbox.xmin BETWEEN ? AND ? AND bbox.ymin BETWEEN ? AND ?
          AND taxonomy."primary" IN ({",".join("?" * len(cats))})
          AND upper(addresses[1].country) = ?
          AND coalesce(operating_status, '') <> 'permanently_closed'
          AND names."primary" IS NOT NULL
        ORDER BY id""", [west, east, south, north, *cats, cc.upper()]).fetchall()
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, f"overture-{cc}.jsonl")
    counts = {}
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        for (oid, name, category, conf, sites, phones, street, postcode, city, lat, lon, datasets) in rows:
            cat = CATEGORIES[category]
            counts[cat] = counts.get(cat, 0) + 1
            line = {"id": oid, "cat": cat, "kind": category, "name": name, "street": street, "postcode": postcode, "city": city,
                    "lat": round(lat, 6), "lon": round(lon, 6), "phone": (phones or [None])[0],
                    "site": (sites or [None])[0], "conf": round(conf or 0, 3),
                    "src": sorted(d for d in (datasets or []) if d), "release": release}
            f.write(json.dumps({k: v for k, v in line.items() if v not in (None, "")}, ensure_ascii=False) + "\n")
    print(f"{cc}: Overture {release}: {len(rows)} candidates {json.dumps(counts)} -> {os.path.relpath(out, ROOT)}")


if __name__ == "__main__":
    main()
