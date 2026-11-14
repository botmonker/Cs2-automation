"""Cito Free client — quota-guarded. 1 call = 1 count. No odds/props on Free.
Usage: CITO_API_KEY=... python3 scripts/cito_client.py --test
--test makes exactly ONE call: GET /health (does not count as a CS2 data call
in the same way, but still logged) then GET /cs2/matches/upcoming?limit=1
and prints the rate-limit headers. Stop on 429 / MONTHLY_LIMIT_REACHED.
"""
import os, sys, json, sqlite3, argparse
import requests

BASE = "https://api.citoapi.com/api/v1"
DB = os.path.join(os.path.dirname(__file__), "..", "db", "cs2_local_test.db")
MONTHLY_LIMIT = 500

def log_call(calls=1):
    con = sqlite3.connect(DB)
    row = con.execute("SELECT calls_used FROM api_usage WHERE provider='cito' ORDER BY id DESC LIMIT 1").fetchone()
    used = (row[0] if row else 0) + calls
    con.execute("INSERT INTO api_usage (provider,period_start,calls_used,calls_remaining,updated_at) VALUES ('cito',date('now'),?,?,datetime('now'))",
                (used, MONTHLY_LIMIT - used))
    con.commit(); con.close()
    return used, MONTHLY_LIMIT - used

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--test", action="store_true"); ap.add_argument("--endpoint", default="/cs2/matches/upcoming")
    a = ap.parse_args()
    key = os.environ.get("CITO_API_KEY")
    if not key:
        print("NO KEY: set CITO_API_KEY env var. No call made."); return 2
    # quota guard: read local counter first
    con = sqlite3.connect(DB)
    row = con.execute("SELECT calls_remaining FROM api_usage WHERE provider='cito' ORDER BY id DESC LIMIT 1").fetchone()
    con.close()
    remaining = row[0] if row else MONTHLY_LIMIT
    if remaining <= 0:
        print("QUOTA EXHAUSTED (local counter). No call made."); return 3
    if remaining < 20:
        print(f"QUOTA LOW ({remaining} left). Fixture-only mode. No optional call."); return 3
    h = {"x-api-key": key}
    r = requests.get(BASE + "/health", headers=h, timeout=15)
    print("health:", r.status_code, r.text[:300])
    if a.test:
        r = requests.get(BASE + a.endpoint, headers=h, params={"limit": 1}, timeout=15)
        print("upcoming status:", r.status_code)
        print("rate-limit headers:", {k: v for k, v in r.headers.items() if "RateLimit" in k or "Cito" in k})
        if r.status_code == 429:
            print("429 — respect Retry-After, do NOT retry in a loop."); return 4
        if r.status_code == 200:
            used, rem = log_call(1)
            data = r.json()
            print("success:", data.get("success"), "meta:", data.get("meta"))
            print(f"local counter: used={used} remaining={rem}")
            return 0
        print("body:", r.text[:500]); return 5
    return 0

if __name__ == "__main__":
    sys.exit(main())
