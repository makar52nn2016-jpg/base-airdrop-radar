#!/usr/bin/env python3
"""Check Vercel deployment status — reads token from env, no hardcoded secrets."""

import json
import os
import urllib.request

VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN")
PROJECT_ID = os.environ.get("PROJECT_ID", "prj_0XyCDQ36NzsyAGRkbu3nEt1IXXn8")

if not VERCEL_TOKEN:
    print("❌ VERCEL_TOKEN env var not set")
    exit(1)

req = urllib.request.Request(
    f"https://api.vercel.com/v6/deployments?projectId={PROJECT_ID}&limit=10&target=production",
    headers={"Authorization": f"Bearer {VERCEL_TOKEN}"},
)
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode())

print(f"Total production deployments: {len(data.get('deployments', []))}")
for d in data.get("deployments", [])[:10]:
    msg = d.get("meta", {}).get("githubCommitMessage", "?")[:80]
    sha = d.get("meta", {}).get("githubCommitSha", "?")[:8]
    print(f"  {d['uid']} | state={d.get('readyState')} | sha={sha} | {msg}")
