"""Prepress worker entrypoint.

Phase 1 step 1: only verifies the Redis connection and stays alive.
Preflight and proof jobs are added in later steps.
"""

import logging
import os
import signal
import time

import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker-prepress")

HEARTBEAT_SECONDS = 30
_running = True


def _stop(signum, _frame):
    global _running
    log.info("Received signal %s, shutting down", signum)
    _running = False


def main() -> None:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    client = redis.Redis.from_url(os.environ["REDIS_URL"])
    client.ping()
    log.info("Connected to Redis, waiting for jobs")

    last_beat = 0.0
    while _running:
        now = time.monotonic()
        if now - last_beat >= HEARTBEAT_SECONDS:
            client.ping()
            log.info("heartbeat ok")
            last_beat = now
        time.sleep(1)


if __name__ == "__main__":
    main()
