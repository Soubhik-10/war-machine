"""Serve the standalone game with Python's standard library."""
import argparse
import http.server
import socket
import urllib.request
import webbrowser
from functools import partial
from pathlib import Path
from threading import Timer


class GameServer(http.server.ThreadingHTTPServer):
    # Windows SO_REUSEADDR can let two processes claim one listening port.
    allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class GameHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-War-Machines", "local-game")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the game in your browser")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535.")
    url = f"http://127.0.0.1:{args.port}/"
    folder = Path(__file__).resolve().parent / "dist"
    try:
        server = GameServer(
            ("127.0.0.1", args.port), partial(GameHandler, directory=str(folder))
        )
    except OSError as error:
        # Reopening the launcher should reuse this game's existing local server.
        try:
            request = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(request, timeout=2) as response:
                already_running = response.headers.get("X-War-Machines") == "local-game"
        except OSError:
            already_running = False
        if already_running:
            print(f"WAR MACHINES is already running: {url}")
            if args.open:
                webbrowser.open(url)
            return
        raise SystemExit(f"Cannot start on port {args.port}: {error}\nUse --port 8767 or close the other server.")
    print(f"WAR MACHINES: {url}", flush=True)
    print("Keep this terminal open. Press Ctrl+C to stop.", flush=True)
    if args.open:
        Timer(0.3, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
