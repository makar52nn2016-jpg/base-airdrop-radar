#!/usr/bin/env python3
"""Set env vars on Vercel project (generic).

Usage:
  export VERCEL_TOKEN='vcp_...'
  export KEY1=value1
  export KEY2=value2
  python3 scripts/set_telegram_env.py KEY1 KEY2

The script will read each provided KEY_NAME from env and set it on Vercel.

NEVER commit real secrets. Read from env.
"""

import json
import os
import sys
import time
import urllib.request

VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN")
PROJECT_ID = os.environ.get("PROJECT_ID", "prj_0XyCDQ36NzsyAGRkbu3nEt1IXXn8")

if not VERCEL_TOKEN:
    print("❌ VERCEL_TOKEN env var not set")
    sys.exit(1)

if len(sys.argv) < 2:
    print(f"Usage: {sys.argv[0]} KEY1 KEY2 ...")
    print(f"Each KEY must be set as an env var before running.")
    sys.exit(1)

API_BASE = "https://api.vercel.com"
KEY_NAMES = sys.argv[1:]

ENV_VARS = {k: os.environ.get(k) for k in KEY_NAMES}

missing = [k for k, v in ENV_VARS.items() if not v]
if missing:
    print(f"❌ Missing env vars: {', '.join(missing)}")
    sys.exit(1)


def api_call(method, path, body=None):
    url = f"{API_BASE}{path}"
    headers = {"Authorization": f"Bearer {VERCEL_TOKEN}", "Content-Type": "application/json"}
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}


# Get existing
existing = api_call("GET", f"/v9/projects/{PROJECT_ID}/env")
existing_map = {}
if "envs" in existing:
    for ev in existing["envs"]:
        existing_map[ev["key"]] = ev["id"]

for key, value in ENV_VARS.items():
    print(f"\n=== Setting {key} ===")
    if key in existing_map:
        ev_id = existing_map[key]
        print(f"  Deleting old (id={ev_id})...")
        api_call("DELETE", f"/v10/projects/{PROJECT_ID}/env/{ev_id}")
        time.sleep(1)

    body = {"key": key, "value": value, "type": "encrypted",
            "target": ["production", "preview", "development"]}
    resp = api_call("POST", f"/v10/projects/{PROJECT_ID}/env", body)
    if "error" in resp:
        print(f"  ⚠ Failed: {resp}")
    else:
        print(f"  ✓ Set")

print("\n✓ All env vars set. Redeploy project to pick up.")
