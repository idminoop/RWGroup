#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def pick_block_ids_by_district(
    apartments: list[dict[str, Any]],
    district_limit: int,
    blocks_per_district: int,
) -> tuple[list[str], list[dict[str, Any]]]:
    district_to_block_counts: dict[str, Counter[str]] = defaultdict(Counter)
    district_totals: Counter[str] = Counter()

    for lot in apartments:
        block_id = str(lot.get("block_id") or "").strip()
        district = str(lot.get("block_district_name") or "").strip()
        if not block_id or not district:
            continue
        district_to_block_counts[district][block_id] += 1
        district_totals[district] += 1

    ordered_districts = sorted(
        district_totals.items(),
        key=lambda item: (-item[1], item[0].lower()),
    )
    selected_districts = ordered_districts[: max(1, district_limit)]

    selected: list[str] = []
    selected_meta: list[dict[str, Any]] = []
    for district, district_lots in selected_districts:
        top_blocks = district_to_block_counts[district].most_common(max(1, blocks_per_district))
        for block_id, lots_count in top_blocks:
            selected.append(block_id)
            selected_meta.append(
                {
                    "district": district,
                    "district_lots_total": district_lots,
                    "block_id": block_id,
                    "block_lots": lots_count,
                }
            )

    return selected, selected_meta


def load_block_ids_from_file(path: Path) -> list[str]:
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    return [line for line in lines if line and not line.startswith("#")]


def compact_address(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        parts = []
        for key in ("street", "house", "housing", "building"):
            raw = str(value.get(key) or "").strip()
            if raw:
                parts.append(raw)
        return ", ".join(parts)
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Build TrendAgent pilot subset by districts/blocks.")
    parser.add_argument("--feed-root", required=True, help="Folder with TrendAgent JSON files")
    parser.add_argument("--out-dir", required=True, help="Output folder for subset")
    parser.add_argument("--district-limit", type=int, default=3, help="Number of districts to sample")
    parser.add_argument("--blocks-per-district", type=int, default=1, help="How many blocks to take per district")
    parser.add_argument(
        "--block-ids-file",
        help="Optional text file with explicit block IDs (one per line). If set, auto district selection is skipped.",
    )
    args = parser.parse_args()

    feed_root = Path(args.feed_root)
    out_dir = Path(args.out_dir)

    apartments = read_json(feed_root / "apartments.json")
    blocks = read_json(feed_root / "blocks.json")
    buildings = read_json(feed_root / "buildings.json")
    builders = read_json(feed_root / "builders.json")
    subways = read_json(feed_root / "subways.json")
    regions = read_json(feed_root / "regions.json")
    rooms = read_json(feed_root / "rooms.json")
    finishings = read_json(feed_root / "finishings.json")
    buildingtypes = read_json(feed_root / "buildingtypes.json")

    if args.block_ids_file:
        selected_block_ids = load_block_ids_from_file(Path(args.block_ids_file))
        selected_meta = [{"source": "block_ids_file", "block_id": block_id} for block_id in selected_block_ids]
    else:
        selected_block_ids, selected_meta = pick_block_ids_by_district(
            apartments=apartments,
            district_limit=args.district_limit,
            blocks_per_district=args.blocks_per_district,
        )

    selected_block_set = set(selected_block_ids)
    if not selected_block_set:
        raise SystemExit("No block IDs selected for subset")

    apartments_subset = [row for row in apartments if str(row.get("block_id") or "") in selected_block_set]
    blocks_subset = [row for row in blocks if str(row.get("_id") or "") in selected_block_set]
    buildings_subset = [row for row in buildings if str(row.get("block_id") or "") in selected_block_set]

    builder_ids = {str(row.get("block_builder") or "") for row in apartments_subset if row.get("block_builder")}
    room_ids_crm = {row.get("room") for row in apartments_subset if row.get("room") is not None}
    finishing_ids = {str(row.get("finishing") or "") for row in apartments_subset if row.get("finishing")}
    building_type_ids = {
        str(row.get("building_type") or "")
        for row in apartments_subset + buildings_subset
        if row.get("building_type")
    }
    region_ids = {str(row.get("district") or "") for row in blocks_subset if row.get("district")}

    subway_ids: set[str] = set()
    for row in apartments_subset:
        block_subway = row.get("block_subway")
        if isinstance(block_subway, list):
            for item in block_subway:
                if isinstance(item, dict) and item.get("subway_id"):
                    subway_ids.add(str(item.get("subway_id")))
    for row in blocks_subset:
        block_subway = row.get("subway")
        if isinstance(block_subway, list):
            for item in block_subway:
                if isinstance(item, dict) and item.get("subway_id"):
                    subway_ids.add(str(item.get("subway_id")))

    builders_subset = [row for row in builders if str(row.get("_id") or "") in builder_ids]
    subways_subset = [row for row in subways if str(row.get("_id") or "") in subway_ids]
    regions_subset = [row for row in regions if str(row.get("_id") or "") in region_ids]
    rooms_subset = [
        row
        for row in rooms
        if row.get("crm_id") in room_ids_crm or str(row.get("_id") or "") in {str(x) for x in room_ids_crm}
    ]
    finishings_subset = [row for row in finishings if str(row.get("_id") or "") in finishing_ids]
    buildingtypes_subset = [row for row in buildingtypes if str(row.get("_id") or "") in building_type_ids]

    write_json(out_dir / "apartments.json", apartments_subset)
    write_json(out_dir / "blocks.json", blocks_subset)
    write_json(out_dir / "buildings.json", buildings_subset)
    write_json(out_dir / "builders.json", builders_subset)
    write_json(out_dir / "subways.json", subways_subset)
    write_json(out_dir / "regions.json", regions_subset)
    write_json(out_dir / "rooms.json", rooms_subset)
    write_json(out_dir / "finishings.json", finishings_subset)
    write_json(out_dir / "buildingtypes.json", buildingtypes_subset)

    about_src = feed_root / "about.json"
    if about_src.exists():
        write_json(out_dir / "about.json", read_json(about_src))

    block_lookup = {str(row.get("_id") or ""): row for row in blocks_subset}
    selection_human = []
    for item in selected_meta:
        block_id = item.get("block_id")
        block = block_lookup.get(str(block_id or ""), {})
        selection_human.append(
            {
                **item,
                "block_name": block.get("name") or "",
                "block_address": compact_address(block.get("address")),
            }
        )

    report = {
        "feed_root": str(feed_root),
        "out_dir": str(out_dir),
        "selected_blocks": selection_human,
        "counts": {
            "apartments": len(apartments_subset),
            "blocks": len(blocks_subset),
            "buildings": len(buildings_subset),
            "builders": len(builders_subset),
            "subways": len(subways_subset),
            "regions": len(regions_subset),
            "rooms": len(rooms_subset),
            "finishings": len(finishings_subset),
            "buildingtypes": len(buildingtypes_subset),
        },
    }
    write_json(out_dir / "subset_report.json", report)
    (out_dir / "block_ids.txt").write_text("\n".join(selected_block_ids), encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
