"""Prepress worker (Phase 2 step 8).

Consumes two BullMQ queues filled by the API; the worker has no database access.

- "prepress": one job per order item with its print file. Checks the file (preflight.py), renders
  proof images (proof.py) to storage, and reports back on the "prepress-results" queue.
- "upload-checks": a customer's file right after upload, before it goes in the cart. Turns it into
  a print PDF (formats.py), checks it, stores the PDF marked as passed or failed for the API, and
  returns the issues as the job's result (the storefront polls for it).
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import signal
import time

import pikepdf
from bullmq import Queue, Worker

from .formats import normalize, select_pages
from .preflight import Geometry, Issue, check_pdf
from .proof import render_proofs
from .storage import Storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker-prepress")

JOBS_QUEUE = "prepress"
RESULTS_QUEUE = "prepress-results"
CHECKS_QUEUE = "upload-checks"


def geometry_tag(geometry: Geometry) -> str:
    """'3.5x2+0.125': the card a file was checked for, compared by the API (same number format as JavaScript)."""
    return f"{geometry.width_in:g}x{geometry.height_in:g}+{geometry.bleed_in:g}"


def process_item(storage: Storage, data: dict) -> dict:
    """Synchronous part of a job (PDF parsing and rendering): runs in a thread."""
    geometry = Geometry.from_job(data["geometry"])
    pdf = storage.read(data["printKey"])
    issues: list[Issue] = check_pdf(
        pdf,
        geometry,
        expected_pages=data["expectedPages"],
        # Template files are drawn by us in CMYK; customer and designer files are checked strictly.
        strict=data["mode"] == "upload",
    )
    proofs = []
    for page, png in enumerate(render_proofs(pdf, geometry, data["expectedPages"]), start=1):
        key = f"proofs/{data['orderItemId']}/{data['run']}-{page}.png"
        storage.write_png(key, png)
        proofs.append({"page": page, "key": key})
    return {"issues": [i.to_dict() for i in issues], "proofs": proofs}


def check_upload(storage: Storage, data: dict) -> dict:
    """One uploaded file (front, or a separate back) for a card size: print PDF, issues, page count."""
    geometry = Geometry.from_job(data["geometry"])
    normalized = normalize(storage.read(data["sourceKey"]), geometry)
    issues = list(normalized.issues)
    pdf = normalized.pdf
    source_pages = _page_count(pdf) if pdf is not None else 0
    pages = data.get("pages")
    if pdf is not None and pages:
        # The customer picked which pages are the front and back: the print PDF holds just those, in order.
        pdf, page_issues = select_pages(pdf, pages)
        issues += page_issues
    page_count = 0
    if pdf is not None:
        names = {1: "Back"} if data["side"] == "back" else {1: "Front", 2: "Back"}
        max_pages = len(pages) if pages else data["maxPages"]
        issues += check_pdf(pdf, geometry, expected_pages=None, max_pages=max_pages, side_names=names)
        page_count = _page_count(pdf)
        passed = not any(i.level == "error" for i in issues)
        storage.write_pdf(data["outputKey"], pdf, {"check": "passed" if passed else "failed", "geometry": geometry_tag(geometry)})
    return {
        "format": normalized.format,
        "issues": [i.to_dict() for i in issues],
        "pageCount": page_count,
        "sourcePageCount": source_pages,
        "outputKey": data["outputKey"] if pdf is not None else None,
    }


def _page_count(pdf: bytes) -> int:
    try:
        with pikepdf.open(io.BytesIO(pdf)) as doc:
            return len(doc.pages)
    except pikepdf.PdfError:
        return 0  # unreadable or password-protected: preflight reports it


async def main() -> None:
    redis_url = os.environ["REDIS_URL"]
    storage = Storage()
    results = Queue(RESULTS_QUEUE, {"connection": redis_url})

    async def handle(job, _token):
        data = job.data
        started = time.monotonic()
        base = {"orderItemId": data["orderItemId"], "printKey": data["printKey"], "run": data["run"]}
        try:
            outcome = await asyncio.to_thread(process_item, storage, data)
            payload = {**base, "ok": True, **outcome}
        except Exception as err:  # reported to the API, which keeps the item pending for staff
            log.exception("prepress failed for %s", data.get("orderItemId"))
            payload = {**base, "ok": False, "error": str(err)[:500]}
        await results.add("result", payload, {"jobId": f"{data['orderItemId']}_{data['run']}", "attempts": 5})
        log.info("checked %s in %.1fs: %s", data["orderItemId"], time.monotonic() - started, payload.get("issues", payload.get("error")))
        return "done"

    async def handle_check(job, _token):
        started = time.monotonic()
        result = await asyncio.to_thread(check_upload, storage, job.data)
        log.info("checked upload %s in %.1fs: %s", job.data["sourceKey"], time.monotonic() - started, [i["code"] for i in result["issues"]])
        return result

    worker = Worker(JOBS_QUEUE, handle, {"connection": redis_url, "concurrency": 2})
    checks = Worker(CHECKS_QUEUE, handle_check, {"connection": redis_url, "concurrency": 2})
    log.info("Waiting for prepress jobs and upload checks")

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    log.info("Shutting down")
    await worker.close()
    await checks.close()
    await results.close()


if __name__ == "__main__":
    asyncio.run(main())
