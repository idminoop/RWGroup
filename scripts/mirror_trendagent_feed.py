#!/usr/bin/env python3
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import threading
import urllib.parse
import urllib.request
from collections import deque
from pathlib import Path

URL_RE = re.compile(r"https?://[^\s\"\\]+")
DEFAULT_ABOUT_URL = "https://dataout.trendagent.ru/msk/about.json"
USER_AGENT = "Mozilla/5.0 (compatible; FeedMirror/1.0)"


def safe_segment(segment: str) -> str:
    forbidden = '<>:"|?*'
    cleaned = "".join("_" if ch in forbidden else ch for ch in segment)
    return cleaned.strip() or "_"


def build_local_path(root: Path, url: str) -> Path:
    parts = urllib.parse.urlsplit(url)
    host = safe_segment(parts.netloc.lower())
    raw_path = urllib.parse.unquote(parts.path or "/")
    if raw_path.endswith("/"):
        raw_path += "index.html"
    if raw_path == "/":
        raw_path = "/index.html"
    path_segments = [safe_segment(seg) for seg in raw_path.lstrip("/").split("/") if seg]
    if not path_segments:
        path_segments = ["index.html"]

    base = root / host
    target = base
    for seg in path_segments[:-1]:
        target /= seg

    filename = path_segments[-1]
    if parts.query:
        stem, dot, ext = filename.partition(".")
        digest = hashlib.sha1(parts.query.encode("utf-8")).hexdigest()[:10]
        if dot:
            filename = f"{stem}__q_{digest}.{ext}"
        else:
            filename = f"{filename}__q_{digest}"
    return target / filename


def download_one(url: str, dest: Path, timeout: int, retries: int) -> tuple[str, str]:
    if dest.exists() and dest.stat().st_size > 0:
        return "skipped", url

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest.with_suffix(dest.suffix + ".part")
    last_err = ""
    for _ in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                with open(tmp_path, "wb") as f:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
            tmp_path.replace(dest)
            return "downloaded", url
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
    if tmp_path.exists():
        tmp_path.unlink(missing_ok=True)
    return f"failed: {last_err}", url


def extract_urls_from_text(text: str) -> list[str]:
    return URL_RE.findall(text)


def localize_json_file(path: Path, root: Path) -> int:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="utf-8", errors="ignore")

    replaced = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal replaced
        src_url = match.group(0)
        local_target = build_local_path(root, src_url)
        relative_str = os.path.relpath(local_target, path.parent).replace("\\", "/")
        replaced += 1
        return relative_str

    updated = URL_RE.sub(repl, text)
    if updated != text:
        path.write_text(updated, encoding="utf-8")
    return replaced


def read_text_safely(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="ignore")


def main() -> int:
    parser = argparse.ArgumentParser(description="Mirror TrendAgent feed to local folders.")
    parser.add_argument("--about-url", default=DEFAULT_ABOUT_URL)
    parser.add_argument("--root", default="feed_mirror")
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] Iterative mirror start from: {args.about_url}")
    discovered_urls: set[str] = {args.about_url}
    processed_urls: set[str] = set()
    queue: deque[str] = deque([args.about_url])
    scanned_json_files: set[Path] = set()

    counts = {"downloaded": 0, "skipped": 0, "failed": 0}
    failures: list[tuple[str, str]] = []
    lock = threading.Lock()

    print(f"[2/5] Downloading discovered URLs with {args.workers} workers (iterative)")
    round_num = 0
    while queue:
        round_num += 1
        batch: list[str] = []
        seen_in_batch: set[str] = set()
        while queue:
            u = queue.popleft()
            if u in processed_urls or u in seen_in_batch:
                continue
            batch.append(u)
            seen_in_batch.add(u)

        if not batch:
            continue

        mapped = {u: build_local_path(root, u) for u in batch}

        print(f"round {round_num}: download batch size={len(batch)}")

        def task(url: str) -> tuple[str, str]:
            return download_one(url, mapped[url], args.timeout, args.retries)

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(task, u): u for u in batch}
            done = 0
            total = len(futures)
            for fut in concurrent.futures.as_completed(futures):
                done += 1
                st, url = fut.result()
                processed_urls.add(url)
                with lock:
                    if st == "downloaded":
                        counts["downloaded"] += 1
                    elif st == "skipped":
                        counts["skipped"] += 1
                    else:
                        counts["failed"] += 1
                        failures.append((url, st))
                if done % 500 == 0 or done == total:
                    print(
                        f"round {round_num} progress {done}/{total} | downloaded={counts['downloaded']} "
                        f"skipped={counts['skipped']} failed={counts['failed']}"
                    )

        # Scan only newly discovered JSON files for new URLs.
        new_urls = 0
        json_files = sorted(root.rglob("*.json"))
        for jf in json_files:
            if jf in scanned_json_files:
                continue
            scanned_json_files.add(jf)
            txt = read_text_safely(jf)
            for found in extract_urls_from_text(txt):
                if found not in discovered_urls:
                    discovered_urls.add(found)
                    queue.append(found)
                    new_urls += 1

        print(
            f"round {round_num}: new_urls={new_urls}, total_discovered={len(discovered_urls)}, "
            f"json_scanned={len(scanned_json_files)}"
        )

    print("[3/5] Rewriting JSON URLs to local relative paths")
    replaced_total = 0
    json_files = sorted(root.rglob("*.json"))
    for jf in json_files:
        replaced_total += localize_json_file(jf, root)

    print("[4/5] Rescanning localized JSON for unresolved external URLs")
    unresolved_external_urls = 0
    unresolved_by_file: list[dict[str, str]] = []
    for jf in json_files:
        txt = read_text_safely(jf)
        leftovers = extract_urls_from_text(txt)
        if leftovers:
            unresolved_external_urls += len(leftovers)
            unresolved_by_file.append({"file": str(jf), "count": str(len(leftovers))})

    print("[5/5] Writing report")
    report = {
        "root": str(root),
        "about_url": args.about_url,
        "json_files": len(json_files),
        "urls_found": len(discovered_urls),
        "urls_processed": len(processed_urls),
        "downloaded": counts["downloaded"],
        "skipped": counts["skipped"],
        "failed": counts["failed"],
        "replacements_in_json": replaced_total,
        "unresolved_external_urls": unresolved_external_urls,
        "unresolved_files": unresolved_by_file[:1000],
        "failures": [{"url": u, "error": e} for u, e in failures[:1000]],
    }
    report_path = root / "mirror_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report: {report_path}")
    print(
        f"Done. downloaded={counts['downloaded']} skipped={counts['skipped']} "
        f"failed={counts['failed']} replaced={replaced_total} unresolved_urls={unresolved_external_urls}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
