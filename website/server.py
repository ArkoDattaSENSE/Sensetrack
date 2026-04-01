from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from refresh_deadlines import DB_PATH, read_database, refresh_database


PROJECT_ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8000


class ConferenceTrackerHandler(SimpleHTTPRequestHandler):
    def _send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b"{}"
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:
        if self.path == "/api/deadlines":
            return self._send_json(read_database())
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/refresh":
            return self._send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)

        body = self._read_json_body()
        conference = body.get("conference")
        try:
            payload = refresh_database(conference=conference if conference else None)
        except Exception as exc:  # noqa: BLE001
            return self._send_json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)

        if conference:
            record = next(
                (item for item in payload.get("conferences", []) if item.get("conference") == conference),
                None,
            )
            return self._send_json(
                {
                    "generated_at": payload.get("generated_at"),
                    "record": record,
                    "failure": next(
                        (item for item in payload.get("failures", []) if item.get("conference") == conference),
                        None,
                    ),
                }
            )

        return self._send_json(payload)


def main() -> int:
    os.chdir(PROJECT_ROOT)
    server = ThreadingHTTPServer((HOST, PORT), ConferenceTrackerHandler)
    print(f"Serving on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
