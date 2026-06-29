#!/usr/bin/env python3
import json
import os
import random
import time
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SERVICE_NAME = os.environ.get("AISRE_DEMO_SERVICE_NAME", "checkout-api")
OTLP_ENDPOINT = os.environ.get("AISRE_DEMO_OTLP_ENDPOINT", "http://otel-collector:4318/v1/traces")
LOG_FILE = Path(os.environ.get("AISRE_DEMO_LOG_FILE", "/var/log/aisre-demo/demo-service.log"))
SLOW_MS = int(os.environ.get("AISRE_DEMO_SLOW_MS", "1250"))

REQUEST_COUNTS = {}
REQUEST_LATENCY_SECONDS = {}


def now_unix_nano():
  return str(time.time_ns())


def random_hex(length):
  return "".join(random.choice("0123456789abcdef") for _ in range(length))


def record_metric(route, status, duration_seconds):
  key = (route, str(status))
  REQUEST_COUNTS[key] = REQUEST_COUNTS.get(key, 0) + 1
  REQUEST_LATENCY_SECONDS[key] = REQUEST_LATENCY_SECONDS.get(key, 0.0) + duration_seconds


def write_log(level, route, status, message, duration_seconds):
  LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
  entry = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "level": level,
    "service": SERVICE_NAME,
    "route": route,
    "status": status,
    "duration_ms": round(duration_seconds * 1000, 2),
    "message": message,
  }
  line = json.dumps(entry, separators=(",", ":"))
  print(line, flush=True)
  with LOG_FILE.open("a", encoding="utf-8") as handle:
    handle.write(line + "\n")


def emit_trace(route, status, duration_seconds, message):
  start = time.time_ns() - int(duration_seconds * 1_000_000_000)
  body = {
    "resourceSpans": [
      {
        "resource": {
          "attributes": [
            {"key": "service.name", "value": {"stringValue": SERVICE_NAME}},
            {"key": "deployment.environment", "value": {"stringValue": "aisre-lab"}},
          ]
        },
        "scopeSpans": [
          {
            "scope": {"name": "supercheck-aisre-demo"},
            "spans": [
              {
                "traceId": random_hex(32),
                "spanId": random_hex(16),
                "name": f"{SERVICE_NAME} {route}",
                "kind": 2,
                "startTimeUnixNano": str(start),
                "endTimeUnixNano": now_unix_nano(),
                "attributes": [
                  {"key": "http.route", "value": {"stringValue": route}},
                  {"key": "http.response.status_code", "value": {"intValue": status}},
                  {"key": "supercheck.fixture", "value": {"stringValue": "oss-lab-checkout-degradation"}},
                  {"key": "duration_ms", "value": {"doubleValue": round(duration_seconds * 1000, 2)}},
                ],
                "status": {"code": 2 if status >= 500 else 1, "message": message},
              }
            ],
          }
        ],
      }
    ]
  }

  data = json.dumps(body).encode("utf-8")
  request = urllib.request.Request(
    OTLP_ENDPOINT,
    data=data,
    headers={"Content-Type": "application/json"},
    method="POST",
  )
  try:
    urllib.request.urlopen(request, timeout=1).read()
  except Exception:
    # The lab is still useful without traces when the traces profile is off.
    pass


def render_metrics():
  lines = [
    "# HELP aisre_demo_requests_total Synthetic AISRE lab requests.",
    "# TYPE aisre_demo_requests_total counter",
  ]
  for (route, status), count in sorted(REQUEST_COUNTS.items()):
    lines.append(f'aisre_demo_requests_total{{service="{SERVICE_NAME}",route="{route}",status="{status}"}} {count}')

  lines.extend([
    "# HELP aisre_demo_request_duration_seconds_total Synthetic AISRE lab request duration sum.",
    "# TYPE aisre_demo_request_duration_seconds_total counter",
  ])
  for (route, status), total in sorted(REQUEST_LATENCY_SECONDS.items()):
    lines.append(f'aisre_demo_request_duration_seconds_total{{service="{SERVICE_NAME}",route="{route}",status="{status}"}} {total:.6f}')

  lines.append(f'aisre_demo_build_info{{service="{SERVICE_NAME}",fixture="oss-lab-checkout-degradation"}} 1')
  return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
  def do_GET(self):
    started = time.perf_counter()
    status = 200
    body = {"service": SERVICE_NAME, "ok": True}
    message = "checkout request succeeded"

    try:
      if self.path == "/health":
        body = {"status": "ok", "service": SERVICE_NAME}
      elif self.path == "/metrics":
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.end_headers()
        self.wfile.write(render_metrics().encode("utf-8"))
        return
      elif self.path == "/checkout":
        body = {"status": "ok", "service": SERVICE_NAME, "scenario": "baseline"}
      elif self.path == "/checkout/slow":
        time.sleep(SLOW_MS / 1000)
        message = "checkout dependency responded slowly"
        body = {"status": "slow", "service": SERVICE_NAME, "duration_ms": SLOW_MS}
      elif self.path == "/checkout/error":
        status = 500
        message = "checkout upstream payment dependency returned 500"
        body = {"status": "error", "service": SERVICE_NAME, "error": "payment dependency returned 500"}
      else:
        status = 404
        message = "not found"
        body = {"status": "not_found", "service": SERVICE_NAME}

      duration = time.perf_counter() - started
      record_metric(self.path, status, duration)
      write_log("error" if status >= 500 else "info", self.path, status, message, duration)
      emit_trace(self.path, status, duration, message)

      payload = json.dumps(body).encode("utf-8")
      self.send_response(status)
      self.send_header("Content-Type", "application/json")
      self.send_header("Content-Length", str(len(payload)))
      self.end_headers()
      self.wfile.write(payload)
    except Exception as exc:
      traceback.print_exc()
      payload = json.dumps({"status": "error", "message": str(exc)}).encode("utf-8")
      self.send_response(500)
      self.send_header("Content-Type", "application/json")
      self.send_header("Content-Length", str(len(payload)))
      self.end_headers()
      self.wfile.write(payload)

  def log_message(self, format, *args):
    return


if __name__ == "__main__":
  server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
  print(json.dumps({"level": "info", "service": SERVICE_NAME, "message": "AISRE demo service listening", "port": 8080}), flush=True)
  server.serve_forever()
