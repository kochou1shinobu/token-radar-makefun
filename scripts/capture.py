#!/usr/bin/env python3
"""Local only. Capture real rendered output from main.ts --preview; never run in the grader.

Renders the four dashboard screenshots (board, detail, watchlist, method) from a
fresh main.ts run on the official snapshot, using the same files the entry
ships, inlined so the capture needs no network. Also smoke-tests the board's
interactions (watchlist filter, search, detail view, sorting, live tab).
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True,
                    help="Official sealed snapshot.json or directory")
parser.add_argument("--chromium", default=os.getenv("CHROMIUM_PATH"),
                    help="Optional installed Chromium executable")
parser.add_argument("--dest", type=pathlib.Path, default=ROOT / "screenshots")
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix="radar-capture-") as tmp:
    out = pathlib.Path(tmp) / "out"
    subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "main.ts"),
         "--input", str(pathlib.Path(args.input).resolve()),
         "--output", str(out), "--preview"],
        check=True,
    )
    rows = json.loads((out / "board.json").read_text())["rows"]
    urls = [
        ("01-board", ""),
        ("02-detail", "?" + urlencode({"view": "detail", "slug": rows[0]["slug"]})),
        ("03-watchlist", "?watch=1"),
        ("04-method", "?view=method"),
    ]
    dest = pathlib.Path(tmp) / "shots"
    dest.mkdir()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=args.chromium, headless=True, args=["--no-sandbox"])
        page = browser.new_page(
            viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        # Render identical local assets inline, with no network or external navigation.
        html = (out / "dashboard/index.html").read_text()
        css = (out / "dashboard/app.css").read_text()
        data = (out / "data.js").read_text().replace("</script", "<\\/script")
        app = (out / "dashboard/app.js").read_text()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        for name, query in urls:
            # The actual page uses URLSearchParams; supply the same query for this offline capture.
            document = (
                html.replace('<link rel="stylesheet" href="app.css">',
                             "<style>" + css + "</style>")
                    .replace('<script src="../data.js"></script>',
                             "<script>" + data + "</script>")
                    .replace('<script src="app.js"></script>',
                             "<script>" + app.replace(
                                 "new URLSearchParams(location.search)",
                                 "new URLSearchParams(" + json.dumps(query) + ")")
                             + "</script>")
            )
            page.set_content(document, wait_until="load")
            page.locator("nav.tabs").wait_for()
            if name == "02-detail":
                last = page.locator(".farm li").last.bounding_box()
                if not last or last["y"] + last["height"] > 900:
                    raise RuntimeError(
                        "Detail screenshot clips farm plan; adjust layout "
                        "or choose representative row.")
            for quality in [86, 78, 68, 58]:
                path = dest / (name + ".jpg")
                page.screenshot(path=str(path), type="jpeg",
                                quality=quality, animations="disabled")
                if path.stat().st_size <= 240 * 1024:
                    break
            if path.stat().st_size > 240 * 1024:
                raise RuntimeError("Screenshot budget exceeded")

        # Interaction smoke test against the same rendered board.
        page.locator('button[data-view="board"]').click()
        page.locator("#watch").check()
        assert page.locator("tr[data-slug]").count() == sum(
            r["on_watchlist"] for r in rows)
        page.locator("#watch").uncheck()
        page.locator("#q").fill(rows[0]["slug"])
        assert page.locator("tr[data-slug]").count() >= 1
        page.locator("tr[data-slug]").first.press("Enter")
        assert page.locator(".farm li").count() == 6
        assert "same number board.json carries" in page.locator(".verify").inner_text()
        page.locator("#back").click()
        page.locator("#q").fill("")
        page.locator("#sort").select_option("rank")
        assert (page.locator("tr[data-slug]").first.get_attribute("data-slug")
                == rows[0]["slug"])
        page.locator('button[data-view="live"]').click()
        assert page.locator("th").filter(has_text="Market cap").count() == 1
        browser.close()
        if errors:
            raise RuntimeError(errors)

    args.dest.mkdir(parents=True, exist_ok=True)
    # Replace only image files, not arbitrary files.
    for file in args.dest.iterdir():
        if file.is_file() and file.suffix.lower() in (".png", ".jpg", ".jpeg"):
            file.unlink()
    for file in sorted(dest.iterdir()):
        shutil.copy2(file, args.dest / file.name)
    print("Captured", [(f.name, f.stat().st_size)
                       for f in sorted(args.dest.glob("*.jpg"))])
