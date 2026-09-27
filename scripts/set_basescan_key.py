#!/usr/bin/env python3
"""Add Basescan API key (or any env var) to Vercel project.

Usage:
  export VERCEL_TOKEN='vcp_...'
  export PROJECT_ID='prj_...'
  export KEY_NAME='BASESCAN_API_KEY'
  export KEY_VALUE='V6G3...'   # from basescan.org/settings/my-api-key
  python3 scripts/set_basescan_key.py

NEVER commit real secrets. Read from env.
"""

import json
import os
import sys
import time
import urllib.request

VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN")
PROJECT_ID = os.environ.get("PROJECT_ID", "prj_0XyCDQ36NzsyAGRkbu3nEt1IXXn8")
KEY_NAME = os.environ.get("KEY_NAME", "BASESCAN_API_KEY")
KEY_VALUE = os.environ.get("KEY_VALUE")

if not VERCEL_TOKEN:
    print("❌ VERCEL_TOKEN env var not set")
    sys.exit(1)
if not KEY_VALUE:
    print(f"❌ KEY_VALUE env var not set (set {KEY_NAME} value via env)")
    sys.exit(1)

API_BASE = "https://api.vercel.com"


def api_call(method, path, body=None):
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {VERCEL_TOKEN}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}


def main():
    # Get existing env vars
    existing = api_call("GET", f"/v9/projects/{PROJECT_ID}/env")
    existing_map = {}
    if "envs" in existing:
        for ev in existing["envs"]:
            existing_map[ev["key"]] = ev["id"]

    # Delete existing KEY_NAME if any
    if KEY_NAME in existing_map:
        ev_id = existing_map[KEY_NAME]
        print(f"Deleting existing {KEY_NAME} (id={ev_id})...")
        api_call("DELETE", f"/v10/projects/{PROJECT_ID}/env/{ev_id}")
        time.sleep(1)

    # Create new
    print(f"Setting {KEY_NAME}...")
    body = {
        "key": KEY_NAME,
        "value": KEY_VALUE,
        "type": "encrypted",
        "target": ["production", "preview", "development"],
    }
    resp = api_call("POST", f"/v10/projects/{PROJECT_ID}/env", body)
    if "error" in resp:
        print(f"Failed: {resp}")
    else:
        print(f"OK. {KEY_NAME} set on all environments.")

    print(f"\nDone. Redeploy project to pick up the new env var.")


if __name__ == "__main__":
    main()
