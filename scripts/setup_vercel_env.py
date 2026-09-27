#!/usr/bin/env python3
"""Set Vercel env vars via API and trigger redeploy.

Usage:
  Set env vars first (do NOT commit them):
    export VERCEL_TOKEN="vcp_..."
    export PROJECT_ID="prj_..."
    export PIMLICO_API_KEY="pim_..."
    export OPENSEA_API_KEY="..."
    export SIGNER_PRIVATE_KEY="0x..."

  Then run:
    python3 scripts/setup_vercel_env.py

Security: never commit real secrets to git. GitHub's secret scanner
will block pushes that contain tokens. Read from env instead.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN")
PROJECT_ID = os.environ.get("PROJECT_ID", "prj_0XyCDQ36NzsyAGRkbu3nEt1IXXn8")
API_BASE = "https://api.vercel.com"

ENV_VARS = {
    "PIMLICO_API_KEY": os.environ.get("PIMLICO_API_KEY"),
    "OPENSEA_API_KEY": os.environ.get("OPENSEA_API_KEY"),
    "SIGNER_PRIVATE_KEY": os.environ.get("SIGNER_PRIVATE_KEY"),
}


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
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()}
    except Exception as e:
        return {"error": str(e)}


def main():
    if not VERCEL_TOKEN:
        print("❌ VERCEL_TOKEN env var not set. Run:")
        print("    export VERCEL_TOKEN='vcp_...'")
        sys.exit(1)

    missing = [k for k, v in ENV_VARS.items() if not v]
    if missing:
        print(f"❌ Missing env vars: {', '.join(missing)}")
        print("Set them before running this script.")
        sys.exit(1)

    # 1. Verify project
    print("=== 1. Verify project ===")
    info = api_call("GET", f"/v9/projects/{PROJECT_ID}")
    if "error" in info:
        print(f"❌ Project verification failed: {info}")
        sys.exit(1)
    print(f"  Project name: {info.get('name', 'unknown')}")

    # 2. Get existing env vars
    print("\n=== 2. Get existing env vars ===")
    existing = api_call("GET", f"/v9/projects/{PROJECT_ID}/env")
    existing_map = {}
    if "envs" in existing:
        for ev in existing["envs"]:
            existing_map[ev["key"]] = ev["id"]
    print(f"  Found {len(existing_map)} existing env vars: {list(existing_map.keys())}")

    # 3. Set each env var (delete if exists, then create)
    for key, value in ENV_VARS.items():
        print(f"\n=== Setting {key} ===")
        if key in existing_map:
            ev_id = existing_map[key]
            print(f"  Existing var found (id={ev_id}), deleting first...")
            api_call("DELETE", f"/v10/projects/{PROJECT_ID}/env/{ev_id}")
            time.sleep(1)

        body = {
            "key": key,
            "value": value,
            "type": "encrypted",
            "target": ["production", "preview", "development"],
        }
        create_resp = api_call("POST", f"/v10/projects/{PROJECT_ID}/env", body)
        if "error" in create_resp:
            print(f"  ⚠ Create failed: {create_resp}")
        else:
            print(f"  ✓ Created (encrypted, all environments)")

    print("\n=== DONE ===")
    print("Now trigger redeploy via git push or Vercel dashboard.")


if __name__ == "__main__":
    main()
