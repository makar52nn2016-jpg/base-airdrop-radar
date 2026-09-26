#!/usr/bin/env python3
"""Set Vercel env vars via API and trigger redeploy."""

import json
import sys
import time
import urllib.request
import urllib.error

VERCEL_TOKEN = "vcp_0kJmPYYZcPN1LYjPjVZtskqwfElHSZvzKO0hKQkjjc1Pm1OswD1W2QKm1Pm1OswD1W2QKm"
PROJECT_ID = "prj_0XyCDQ36NzsyAGRkbu3nEt1IXXn8"
API_BASE = "https://api.vercel.com"

ENV_VARS = {
    "PIMLICO_API_KEY": "pim_VXiKbWFNUjQqKPh8x7ui4g",
    "OPENSEA_API_KEY": "3b2150459f1b4a43ac711552254cb43c",
    "SIGNER_PRIVATE_KEY": "0xf28836ed0f3d4786c13469f13254bbe80999a27c41593480968835f3d064d3af",
}


def api_call(method, path, body=None):
    """Make an authenticated Vercel API call."""
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
    # 1. Verify project
    print("=== 1. Verify project ===")
    info = api_call("GET", f"/v9/projects/{PROJECT_ID}")
    if "error" in info:
        print(f"❌ Project verification failed: {info}")
        sys.exit(1)
    print(f"  Project name: {info.get('name', 'unknown')}")
    print(f"  Framework: {info.get('framework', 'unknown')}")

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

        # Delete if exists
        if key in existing_map:
            ev_id = existing_map[key]
            print(f"  Existing var found (id={ev_id}), deleting first...")
            del_resp = api_call("DELETE", f"/v10/projects/{PROJECT_ID}/env/{ev_id}")
            if "error" in del_resp:
                print(f"  ⚠ Delete failed: {del_resp}")
            else:
                print(f"  ✓ Deleted old")
            time.sleep(1)

        # Create new
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
            new_id = create_resp.get("id", "?")
            print(f"  ✓ Created (id={new_id}, encrypted, all environments)")

    # 4. Get latest deployment
    print("\n=== 4. Get latest deployment ===")
    deploys = api_call("GET", f"/v6/deployments?projectId={PROJECT_ID}&limit=1")
    if "error" in deploys:
        print(f"❌ Failed to fetch deployments: {deploys}")
        sys.exit(1)

    deployments = deploys.get("deployments", [])
    if not deployments:
        print("  No deployments found — triggering fresh deploy via git push or new build")
        sys.exit(0)

    latest = deployments[0]
    deploy_uid = latest.get("uid")
    deploy_state = latest.get("state", "unknown")
    print(f"  Latest deployment: {deploy_uid} (state: {deploy_state})")

    # 5. Redeploy
    print("\n=== 5. Triggering redeploy ===")
    redeploy_body = {
        "deploymentId": deploy_uid,
        "forceNewBuilder": False,
    }
    redeploy_resp = api_call(
        "POST",
        f"/v13/deployments/{deploy_uid}/redeploy?forceNewBuilder=false",
        redeploy_body,
    )
    if "error" in redeploy_resp:
        print(f"  ⚠ Redeploy failed: {redeploy_resp}")
        print("  You may need to manually trigger redeploy in Vercel dashboard")
    else:
        new_uid = redeploy_resp.get("uid", "?")
        new_url = redeploy_resp.get("url", "?")
        ready_state = redeploy_resp.get("readyState", "BUILDING")
        print(f"  ✓ Redeploy triggered")
        print(f"  New deployment UID: {new_uid}")
        print(f"  URL: https://{new_url}")
        print(f"  State: {ready_state}")

    print("\n=== DONE ===")
    print("Wait ~2 min for build, then verify:")
    print("https://base-airdrop-radar.vercel.app/api/sniper/status")
    print("\nExpected JSON should show:")
    print('  pimlico.configured: true')
    print('  opensea.configured: true')
    print('  smart_account_address: "0x21fd64B5616857652f95275a929E335759e3d329"')


if __name__ == "__main__":
    main()
