"""Prepress worker (Phase 2 step 8).

Consumes the BullMQ queue "prepress" filled by the API: one job per order item with its print file.
Checks the file (preflight.py), renders proof images (proof.py) to storage, and reports back on the
"prepress-results" queue, which the API consumes. The worker has no database access.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import time

from bullmq import Queue, Worker

from .preflight import Geometry, Issue, check_pdf
from .proof import render_proofs
from .storage import Storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker-prepress")

JOBS_QUEUE = "prepress"
RESULTS_QUEUE = "prepress-results"


def process_item(storage: Storage, data: dict) -> dict:
    """Synchronous part of a job (PDF parsing and rendering): runs in a thread."""
    geometry = Geometry.from_job(data["geometry"])
    pdf = storage.read(data["printKey"])
    issues: list[Issue] = check_pdf(
        pdf,
        geometry,
        expected_pages=data["expectedPages"],
        # Template files are drawn by us in RGB on purpose; only customer files get the RGB warning.
        check_rgb=data["mode"] == "upload",
    )
    proofs = []
    for page, png in enumerate(render_proofs(pdf, geometry, data["expectedPages"]), start=1):
        key = f"proofs/{data['orderItemId']}/{data['run']}-{page}.png"
        storage.write_png(key, png)
        proofs.append({"page": page, "key": key})
    return {"issues": [i.to_dict() for i in issues], "proofs": proofs}


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

    worker = Worker(JOBS_QUEUE, handle, {"connection": redis_url, "concurrency": 2})
    log.info("Waiting for prepress jobs")

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    log.info("Shutting down")
    await worker.close()
    await results.close()


if __name__ == "__main__":
    asyncio.run(main())
