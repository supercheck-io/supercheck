#!/usr/bin/env python3
import hashlib
import json
import os
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_EVENTS = int(os.environ.get("AISRE_WEBHOOK_MAX_EVENTS", "200"))
EVENTS = deque(maxlen=MAX_EVENTS)


def json_response(handler, status, body):
  payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
  handler.send_response(status)
  handler.send_header("Content-Type", "application/json")
  handler.send_header("Content-Length", str(len(payload)))
  handler.end_headers()
  handler.wfile.write(payload)


class Handler(BaseHTTPRequestHandler):
  def do_GET(self):
    if self.path == "/health":
      json_response(self, 200, {"status": "ok", "stored": len(EVENTS), "max": MAX_EVENTS})
      return

    if self.path == "/payloads":
      json_response(self, 200, {"events": list(EVENTS)})
      return

    if self.path == "/metrics":
      payload = (
        "# HELP aisre_webhook_capture_events_total Captured webhook events.\n"
        "# TYPE aisre_webhook_capture_events_total counter\n"
        f"aisre_webhook_capture_events_total {len(EVENTS)}\n"
      ).encode("utf-8")
      self.send_response(200)
      self.send_header("Content-Type", "text/plain; version=0.0.4")
      self.send_header("Content-Length", str(len(payload)))
      self.end_headers()
      self.wfile.write(payload)
      return

    json_response(self, 404, {"error": "not found"})

  def do_POST(self):
    length = int(self.headers.get("content-length", "0"))
    raw_body = self.rfile.read(length)
    body_text = raw_body.decode("utf-8", errors="replace")

    event = {
      "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
      "method": "POST",
      "path": self.path,
      "bodySha256": hashlib.sha256(raw_body).hexdigest(),
      "bodyPreview": body_text[:4096],
      "headers": {
        key: value
        for key, value in self.headers.items()
        if key.lower() not in {"authorization", "cookie", "x-api-key"}
      },
    }
    EVENTS.append(event)
    print(json.dumps({"level": "info", "message": "captured webhook", "path": self.path, "bodySha256": event["bodySha256"]}), flush=True)
    json_response(self, 202, {"status": "accepted", "bodySha256": event["bodySha256"]})

  def log_message(self, format, *args):
    return


if __name__ == "__main__":
  server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
  print(json.dumps({"level": "info", "message": "AISRE webhook capture listening", "port": 8080}), flush=True)
  server.serve_forever()
