#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def non_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return True


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


def coverage(rows: list[dict[str, Any]], field: str) -> dict[str, Any]:
    filled = sum(1 for row in rows if non_empty(row.get(field)))
    total = len(rows)
    pct = (filled / total * 100) if total else 0
    return {"filled": filled, "total": total, "pct": round(pct, 2)}


def find_duplicates(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    counter = Counter(str(row.get(key) or "").strip() for row in rows)
    return {value: count for value, count in counter.items() if value and count > 1}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate canonical import rows for RWGroup.")
    parser.add_argument("--properties", required=True, help="Path to properties_rows.json")
    parser.add_argument("--complexes", required=True, help="Path to complexes_rows.json")
    parser.add_argument("--report", help="Optional path to save validation report json")
    parser.add_argument(
        "--coverage-threshold",
        type=float,
        default=95.0,
        help="Minimum target coverage percentage for key fields",
    )
    args = parser.parse_args()

    properties_path = Path(args.properties)
    complexes_path = Path(args.complexes)
    properties = read_json(properties_path)
    complexes = read_json(complexes_path)

    if not isinstance(properties, list) or not isinstance(complexes, list):
        raise SystemExit("Both properties and complexes files must contain JSON arrays")

    errors: list[str] = []
    warnings: list[str] = []

    required_property_fields = ["external_id", "complex_external_id", "title", "bedrooms", "price", "area_total"]
    required_complex_fields = ["external_id", "title", "district"]

    for index, row in enumerate(properties, start=1):
        if not isinstance(row, dict):
            errors.append(f"Property row #{index} is not an object")
            continue
        for field in required_property_fields:
            if not non_empty(row.get(field)):
                errors.append(f"Property row #{index} missing required field: {field}")
        bedrooms = as_float(row.get("bedrooms"))
        if bedrooms is None or bedrooms < 0:
            errors.append(f"Property row #{index} invalid bedrooms: {row.get('bedrooms')}")
        price = as_float(row.get("price"))
        if price is None or price <= 0:
            errors.append(f"Property row #{index} invalid price: {row.get('price')}")
        area_total = as_float(row.get("area_total"))
        if area_total is None or area_total <= 0:
            errors.append(f"Property row #{index} invalid area_total: {row.get('area_total')}")

    for index, row in enumerate(complexes, start=1):
        if not isinstance(row, dict):
            errors.append(f"Complex row #{index} is not an object")
            continue
        for field in required_complex_fields:
            if not non_empty(row.get(field)):
                errors.append(f"Complex row #{index} missing required field: {field}")

    property_duplicates = find_duplicates(properties, "external_id")
    complex_duplicates = find_duplicates(complexes, "external_id")
    if property_duplicates:
        errors.append(f"Duplicate property external_id values: {len(property_duplicates)}")
    if complex_duplicates:
        errors.append(f"Duplicate complex external_id values: {len(complex_duplicates)}")

    complex_ids = {str(row.get("external_id") or "").strip() for row in complexes if isinstance(row, dict)}
    dangling_links = [
        str(row.get("external_id") or "")
        for row in properties
        if isinstance(row, dict)
        and str(row.get("complex_external_id") or "").strip()
        and str(row.get("complex_external_id") or "").strip() not in complex_ids
    ]
    if dangling_links:
        errors.append(f"Properties without linked complex_external_id in complexes rows: {len(dangling_links)}")

    property_coverage_targets = ["metro", "floors_total", "renovation", "lot_number"]
    complex_coverage_targets = ["developer", "handover_date", "geo_lat", "geo_lon"]
    property_coverage = {field: coverage(properties, field) for field in property_coverage_targets}
    complex_coverage = {field: coverage(complexes, field) for field in complex_coverage_targets}

    threshold_failures = []
    for field, stats in {**property_coverage, **complex_coverage}.items():
        if stats["pct"] < args.coverage_threshold:
            threshold_failures.append(f"{field}: {stats['pct']}% < {args.coverage_threshold}%")
    if threshold_failures:
        warnings.extend(threshold_failures)

    report = {
        "files": {"properties": str(properties_path), "complexes": str(complexes_path)},
        "counts": {"properties": len(properties), "complexes": len(complexes)},
        "errors": errors,
        "warnings": warnings,
        "duplicates": {
            "properties_external_id": property_duplicates,
            "complexes_external_id": complex_duplicates,
        },
        "dangling_property_links_count": len(dangling_links),
        "coverage": {"properties": property_coverage, "complexes": complex_coverage},
        "threshold": {"coverage_pct_min": args.coverage_threshold},
    }

    if args.report:
        write_json(Path(args.report), report)

    print(json.dumps(report, ensure_ascii=False, indent=2))

    if errors:
        return 2
    if threshold_failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
