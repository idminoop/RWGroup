#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def as_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(" ", "").replace(",", ".")
    if not text:
        return None
    try:
        parsed = float(text)
        if parsed != parsed or parsed in (float("inf"), float("-inf")):
            return None
        return parsed
    except ValueError:
        return None


def as_int(value: Any) -> int | None:
    parsed = as_float(value)
    if parsed is None:
        return None
    return int(parsed)


def as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if value == 1:
            return True
        if value == 0:
            return False
    text = str(value).strip().lower()
    if not text:
        return None
    if text in {"1", "true", "yes", "on", "да"}:
        return True
    if text in {"0", "false", "no", "off", "нет"}:
        return False
    return None


def dedupe_keep_order(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = raw.strip()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def normalize_asset_url(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("http://") or text.startswith("https://"):
        return text
    if text.startswith("//"):
        return f"https:{text}"

    cleaned = text
    while cleaned.startswith("../"):
        cleaned = cleaned[3:]
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    cleaned = cleaned.lstrip("/")
    if not cleaned:
        return ""
    if "." in cleaned.split("/", 1)[0]:
        return f"https://{cleaned}"
    return text


def normalize_images(value: Any) -> list[str]:
    if isinstance(value, list):
        images = [normalize_asset_url(item) for item in value]
    else:
        images = [normalize_asset_url(value)]
    return dedupe_keep_order([img for img in images if img])


def parse_handover_parts(raw: Any) -> tuple[int | None, int | None, str | None]:
    text = str(raw or "").strip()
    if not text:
        return None, None, None
    try:
        normalized = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        quarter = ((dt.month - 1) // 3) + 1
        return quarter, dt.year, f"{quarter} кв. {dt.year}"
    except ValueError:
        return None, None, None


def compact_address(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, dict):
        return ""
    parts = []
    for key in ("street", "house", "housing", "building"):
        token = str(value.get(key) or "").strip()
        if token:
            parts.append(token)
    return ", ".join(parts)


def extract_geo(value: Any) -> tuple[float | None, float | None]:
    if not isinstance(value, dict):
        return None, None
    coords = value.get("coordinates")
    if isinstance(coords, list) and len(coords) >= 2:
        lon = as_float(coords[0])
        lat = as_float(coords[1])
        if lat is not None and lon is not None:
            return lat, lon
    return None, None


def parse_bedrooms(room_code: Any, room_name: str) -> tuple[int, bool]:
    code = as_int(room_code)
    name_lc = room_name.lower()

    if code in {0, 1001} or "студ" in name_lc:
        return 0, False

    euro_codes = {22: 2, 23: 3, 24: 4, 25: 5}
    if code in euro_codes:
        return euro_codes[code], True

    if isinstance(code, int) and 1 <= code <= 10:
        return code, False
    if isinstance(code, int) and 1002 <= code <= 1011:
        return code - 1001, False

    match = re.search(r"(\d+)", room_name)
    bedrooms = int(match.group(1)) if match else 1
    is_euro = bool(re.search(r"[еe]", room_name, flags=re.IGNORECASE))
    return bedrooms, is_euro


def non_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return True


def prune_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def main() -> int:
    parser = argparse.ArgumentParser(description="Export TrendAgent feed to canonical RWGroup import rows.")
    parser.add_argument("--feed-root", required=True, help="Folder with TrendAgent JSON files")
    parser.add_argument("--out-dir", required=True, help="Where to write properties_rows.json and complexes_rows.json")
    args = parser.parse_args()

    feed_root = Path(args.feed_root)
    out_dir = Path(args.out_dir)

    apartments = read_json(feed_root / "apartments.json")
    blocks = read_json(feed_root / "blocks.json")
    buildings = read_json(feed_root / "buildings.json")
    rooms = read_json(feed_root / "rooms.json")
    finishings = read_json(feed_root / "finishings.json")
    buildingtypes = read_json(feed_root / "buildingtypes.json")
    subways = read_json(feed_root / "subways.json")
    regions = read_json(feed_root / "regions.json")
    builders = read_json(feed_root / "builders.json")

    blocks_by_id = {str(row.get("_id") or ""): row for row in blocks}
    buildings_by_id = {str(row.get("_id") or ""): row for row in buildings}
    room_name_by_crm = {row.get("crm_id"): str(row.get("name") or "") for row in rooms}
    finishing_name_by_id = {str(row.get("_id") or ""): str(row.get("name") or "") for row in finishings}
    building_type_name_by_id = {str(row.get("_id") or ""): str(row.get("name") or "") for row in buildingtypes}
    subway_name_by_id = {str(row.get("_id") or ""): str(row.get("name") or "") for row in subways}
    region_name_by_id = {str(row.get("_id") or ""): str(row.get("name") or "") for row in regions}
    builder_name_by_id = {str(row.get("_id") or ""): str(row.get("name") or "") for row in builders}

    properties_rows: list[dict[str, Any]] = []
    complex_stats: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "prices": [],
            "areas": [],
            "images": [],
            "metros": set(),
            "developers": Counter(),
            "finish_types": Counter(),
            "deadlines": [],
            "districts": Counter(),
            "titles": Counter(),
            "addresses": Counter(),
            "building_types": Counter(),
            "queue_values": [],
            "mortgage": [],
            "installment": [],
            "subsidy": [],
            "military_mortgage": [],
            "geo": [],
            "description": None,
        }
    )

    for lot in apartments:
        external_id = str(lot.get("_id") or "").strip()
        block_id = str(lot.get("block_id") or "").strip()
        if not external_id or not block_id:
            continue

        block = blocks_by_id.get(block_id, {})
        building = buildings_by_id.get(str(lot.get("building_id") or ""), {})

        block_name = str(lot.get("block_name") or block.get("name") or block_id).strip()
        district = str(lot.get("block_district_name") or "").strip()
        if not district:
            district = str(region_name_by_id.get(str(block.get("district") or ""), "")).strip()

        metros = []
        raw_block_subway_name = lot.get("block_subway_name")
        if isinstance(raw_block_subway_name, list):
            metros.extend([str(item).strip() for item in raw_block_subway_name if str(item).strip()])
        elif isinstance(raw_block_subway_name, str):
            metros.extend([part.strip() for part in re.split(r"[,;|]", raw_block_subway_name) if part.strip()])

        if not metros:
            for key in ("block_subway",):
                source = lot.get(key)
                if isinstance(source, list):
                    for item in source:
                        if isinstance(item, dict):
                            subway_id = str(item.get("subway_id") or "").strip()
                            if subway_id and subway_id in subway_name_by_id:
                                metros.append(subway_name_by_id[subway_id])
        if not metros and isinstance(block.get("subway"), list):
            for item in block.get("subway"):
                if isinstance(item, dict):
                    subway_id = str(item.get("subway_id") or "").strip()
                    if subway_id and subway_id in subway_name_by_id:
                        metros.append(subway_name_by_id[subway_id])
        metros = dedupe_keep_order(metros)

        room_code = lot.get("room")
        room_name = room_name_by_crm.get(room_code, "")
        bedrooms, is_euroflat = parse_bedrooms(room_code, room_name)
        finishing_id = str(lot.get("finishing") or "").strip()
        renovation = finishing_name_by_id.get(finishing_id, finishing_id or None)

        price = as_float(lot.get("price"))
        area_total = as_float(lot.get("area_total"))
        area_living = as_float(lot.get("area_rooms_total"))
        area_kitchen = as_float(lot.get("area_kitchen"))
        floor = as_int(lot.get("floor"))
        floors_total = as_int(lot.get("floors"))
        lot_number = str(lot.get("number") or "").strip() or None
        building_section = str(lot.get("building_name") or "").strip() or None
        description = str(block.get("description") or "").strip() or None
        address = compact_address(lot.get("block_address")) or compact_address(block.get("address")) or None

        deadline_raw = lot.get("building_deadline") or building.get("deadline")
        ready_quarter, built_year, handover_date = parse_handover_parts(deadline_raw)

        building_type_id = str(lot.get("building_type") or building.get("building_type") or "").strip()
        building_type = building_type_name_by_id.get(building_type_id, building_type_id or None)

        geo_lat, geo_lon = extract_geo(lot.get("block_geometry"))
        if geo_lat is None or geo_lon is None:
            geo_lat, geo_lon = extract_geo(block.get("geometry"))

        plan_images = normalize_images(lot.get("plan"))
        block_images = normalize_images(block.get("renderer"))
        images = plan_images or block_images

        mortgage_available = as_bool(lot.get("building_mortgage"))
        installment_available = as_bool(lot.get("building_installment"))
        subsidy_available = as_bool(lot.get("building_subsidy"))
        military_mortgage_available = as_bool(lot.get("building_voen_mortgage"))
        building_queue = as_int(lot.get("building_queue") or building.get("queue"))
        developer = str(lot.get("block_builder_name") or builder_name_by_id.get(str(lot.get("block_builder") or ""), "")).strip() or None

        if bedrooms == 0:
            title = f"Студия в {block_name}"
        elif is_euroflat:
            title = f"{bedrooms}Е в {block_name}"
        else:
            title = f"{bedrooms}-комн. в {block_name}"

        property_row = prune_none(
            {
                "external_id": external_id,
                "complex_external_id": block_id,
                "complex_title": block_name,
                "deal_type": "sale",
                "category": "newbuild",
                "title": title,
                "bedrooms": bedrooms,
                "price": price,
                "area_total": area_total,
                "area_living": area_living,
                "area_kitchen": area_kitchen,
                "district": district,
                "metro": metros,
                "images": images,
                "status": "active",
                "floor": floor,
                "floors_total": floors_total,
                "renovation": renovation,
                "is_euroflat": is_euroflat,
                "building_section": building_section,
                "lot_number": lot_number,
                "ready_quarter": ready_quarter,
                "built_year": built_year,
                "handover_date": handover_date,
                "description": description,
                "address": address,
                "developer": developer,
                "finish_type": renovation,
                "geo_lat": geo_lat,
                "geo_lon": geo_lon,
                "mortgage_available": mortgage_available,
                "installment_available": installment_available,
                "subsidy_available": subsidy_available,
                "military_mortgage_available": military_mortgage_available,
                "building_queue": building_queue,
                "queue_min": building_queue,
                "building_type": building_type,
            }
        )
        properties_rows.append(property_row)

        stat = complex_stats[block_id]
        if price is not None and price > 0:
            stat["prices"].append(price)
        if area_total is not None and area_total > 0:
            stat["areas"].append(area_total)
        stat["images"].extend(images)
        for metro in metros:
            stat["metros"].add(metro)
        if developer:
            stat["developers"][developer] += 1
        if renovation:
            stat["finish_types"][renovation] += 1
        if deadline_raw:
            stat["deadlines"].append(str(deadline_raw))
        if district:
            stat["districts"][district] += 1
        if block_name:
            stat["titles"][block_name] += 1
        if address:
            stat["addresses"][address] += 1
        if building_type:
            stat["building_types"][building_type] += 1
        if isinstance(building_queue, int) and building_queue > 0:
            stat["queue_values"].append(building_queue)
        if mortgage_available is not None:
            stat["mortgage"].append(mortgage_available)
        if installment_available is not None:
            stat["installment"].append(installment_available)
        if subsidy_available is not None:
            stat["subsidy"].append(subsidy_available)
        if military_mortgage_available is not None:
            stat["military_mortgage"].append(military_mortgage_available)
        if geo_lat is not None and geo_lon is not None:
            stat["geo"].append((geo_lat, geo_lon))
        if not stat["description"]:
            stat["description"] = description

    def most_common(counter: Counter[str]) -> str | None:
        if not counter:
            return None
        return counter.most_common(1)[0][0]

    complexes_rows: list[dict[str, Any]] = []
    for block_id, stat in sorted(complex_stats.items(), key=lambda item: item[0]):
        block = blocks_by_id.get(block_id, {})
        title = most_common(stat["titles"]) or str(block.get("name") or block_id)
        district = most_common(stat["districts"]) or str(region_name_by_id.get(str(block.get("district") or ""), "")).strip()
        address = most_common(stat["addresses"]) or compact_address(block.get("address")) or None
        images = normalize_images(block.get("renderer")) or dedupe_keep_order(stat["images"])
        developer = most_common(stat["developers"])
        finish_type = most_common(stat["finish_types"])
        building_type = most_common(stat["building_types"])
        queue_min = min(stat["queue_values"]) if stat["queue_values"] else None

        deadline_dates = sorted(stat["deadlines"])
        _, _, handover_date = parse_handover_parts(deadline_dates[0]) if deadline_dates else (None, None, None)

        geo_lat = None
        geo_lon = None
        if stat["geo"]:
            geo_lat, geo_lon = stat["geo"][0]
        else:
            geo_lat, geo_lon = extract_geo(block.get("geometry"))

        mortgage_available = True if True in stat["mortgage"] else (False if stat["mortgage"] else None)
        installment_available = True if True in stat["installment"] else (False if stat["installment"] else None)
        subsidy_available = True if True in stat["subsidy"] else (False if stat["subsidy"] else None)
        military_mortgage_available = (
            True if True in stat["military_mortgage"] else (False if stat["military_mortgage"] else None)
        )

        complex_row = prune_none(
            {
                "external_id": block_id,
                "title": title,
                "category": "newbuild",
                "district": district,
                "metro": sorted(stat["metros"]),
                "price_from": min(stat["prices"]) if stat["prices"] else None,
                "area_from": min(stat["areas"]) if stat["areas"] else None,
                "images": images,
                "status": "active",
                "developer": developer,
                "finish_type": finish_type,
                "handover_date": handover_date,
                "description": stat["description"] or str(block.get("description") or "").strip() or None,
                "address": address,
                "geo_lat": geo_lat,
                "geo_lon": geo_lon,
                "mortgage_available": mortgage_available,
                "installment_available": installment_available,
                "subsidy_available": subsidy_available,
                "military_mortgage_available": military_mortgage_available,
                "queue_min": queue_min,
                "building_type": building_type,
            }
        )
        complexes_rows.append(complex_row)

    properties_rows.sort(key=lambda row: str(row.get("external_id") or ""))
    complexes_rows.sort(key=lambda row: str(row.get("external_id") or ""))

    write_json(out_dir / "properties_rows.json", properties_rows)
    write_json(out_dir / "complexes_rows.json", complexes_rows)

    def coverage(rows: list[dict[str, Any]], field: str) -> dict[str, Any]:
        filled = sum(1 for row in rows if non_empty(row.get(field)))
        total = len(rows)
        pct = (filled / total * 100) if total else 0
        return {"filled": filled, "total": total, "pct": round(pct, 2)}

    report = {
        "feed_root": str(feed_root),
        "out_dir": str(out_dir),
        "counts": {"properties": len(properties_rows), "complexes": len(complexes_rows)},
        "coverage_properties": {
            key: coverage(properties_rows, key)
            for key in ["external_id", "complex_external_id", "bedrooms", "price", "area_total", "district", "metro", "images", "floors_total", "renovation", "lot_number"]
        },
        "coverage_complexes": {
            key: coverage(complexes_rows, key)
            for key in ["external_id", "title", "district", "metro", "price_from", "area_from", "images", "developer", "handover_date", "geo_lat", "geo_lon"]
        },
    }
    write_json(out_dir / "export_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
