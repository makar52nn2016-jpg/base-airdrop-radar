#!/usr/bin/env python3
"""
Добавляет CRON_SECRET в Vercel env vars и триггерит production redeploy.
Использует Vercel REST API — НЕ требует vercel CLI.

Чтение:
- VERCEL_TOKEN из env (если нет, использует hardcoded из setup_vercel_env.sh)
- PROJECT_ID из env (если нет, использует default)
- CRON_SECRET из /home/z/my-project/scripts/cron_secret.txt
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

# Credentials (из setup_vercel_env.sh — уже использовались ранее)
VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN") or "vcp_0kJmPYYZcPN1LYjPjVZtskqwfElHSZvzKO0hKQkjjc1Pm1OswD1W2QKm1Pm1OswD1W2QKm"
PROJECT_ID = os.environ.get("PROJECT_ID") or "prj_0XyCDQ36NzsyAGRkbu3nEt1IXXn8"
API_BASE = "https://api.vercel.com"

SECRET_FILE = Path("/home/z/my-project/scripts/cron_secret.txt")
CRON_SECRET = SECRET_FILE.read_text().strip()

print(f"=== Vercel API: добавление CRON_SECRET ===")
print(f"Project ID: {PROJECT_ID}")
print(f"Secret length: {len(CRON_SECRET)} chars")
print()

# === 1. Получаем список env vars ===
print("=== 1. Получаем текущие env vars ===")
req = urllib.request.Request(
    f"{API_BASE}/v9/projects/{PROJECT_ID}/env",
    headers={"Authorization": f"Bearer {VERCEL_TOKEN}"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        env_data = json.loads(resp.read().decode())
except urllib.error.HTTPError as e:
    print(f"❌ Ошибка: {e.code} {e.reason}")
    sys.exit(1)

existing_id = None
for env in env_data.get("envs", []):
    if env.get("key") == "CRON_SECRET":
        existing_id = env.get("id")
        print(f"   Found existing CRON_SECRET (id={existing_id}), удаляем")
        # Удаляем существующий
        del_req = urllib.request.Request(
            f"{API_BASE}/v10/projects/{PROJECT_ID}/env/{existing_id}",
            method="DELETE",
            headers={"Authorization": f"Bearer {VERCEL_TOKEN}"},
        )
        with urllib.request.urlopen(del_req, timeout=30) as resp:
            print(f"   ✓ Deleted (status {resp.status})")
        break

# === 2. Добавляем новый CRON_SECRET ===
print("\n=== 2. Добавляем CRON_SECRET ===")
create_data = json.dumps({
    "key": "CRON_SECRET",
    "value": CRON_SECRET,
    "type": "encrypted",
    "target": ["production", "preview", "development"],
}).encode()

create_req = urllib.request.Request(
    f"{API_BASE}/v10/projects/{PROJECT_ID}/env",
    method="POST",
    headers={
        "Authorization": f"Bearer {VERCEL_TOKEN}",
        "Content-Type": "application/json",
    },
    data=create_data,
)
try:
    with urllib.request.urlopen(create_req, timeout=30) as resp:
        result = json.loads(resp.read().decode())
        print(f"   ✓ Created (id={result.get('id')})")
except urllib.error.HTTPError as e:
    err_msg = e.read().decode()
    print(f"   ❌ Ошибка: {e.code} {err_msg}")
    sys.exit(1)

# === 3. Получаем список deployments (последние 3) ===
print("\n=== 3. Получаем список deployments ===")
req = urllib.request.Request(
    f"{API_BASE}/v6/deployments?projectId={PROJECT_ID}&limit=5",
    headers={"Authorization": f"Bearer {VERCEL_TOKEN}"},
)
with urllib.request.urlopen(req, timeout=30) as resp:
    deploys = json.loads(resp.read().decode())

latest_prod = None
for d in deploys.get("deployments", []):
    is_prod = d.get("target") == "production"
    print(f"   {d.get('uid','')[:12]} | state={d.get('readyState'):10} | target={d.get('target'):10} | sha={d.get('meta',{}).get('githubCommitSha','?')[:8]}")
    if is_prod and d.get("readyState") == "READY":
        latest_prod = d

if not latest_prod:
    print("\n❌ Не найден production deployment в статусе READY")
    sys.exit(1)

DEPLOY_UID = latest_prod.get("uid")
print(f"\n   Latest production READY deployment: {DEPLOY_UID}")

# === 4. Получаем git SHA этого deployment ===
GIT_SHA = latest_prod.get("meta", {}).get("githubCommitSha", "")
if GIT_SHA:
    print(f"   Git SHA: {GIT_SHA}")

# === 5. Триггерим redeploy на тот же commit ===
print("\n=== 4. Триггерим redeploy (на тот же commit) ===")
deploy_data = json.dumps({
    "gitSource": {
        "type": "github",
        "projectId": PROJECT_ID,
        "ref": "main",
        "sha": GIT_SHA,
    },
    "target": "production",
}).encode()

deploy_req = urllib.request.Request(
    f"{API_BASE}/v13/deployments?projectId={PROJECT_ID}&forceFresh=1&skipDomainVerification=1",
    method="POST",
    headers={
        "Authorization": f"Bearer {VERCEL_TOKEN}",
        "Content-Type": "application/json",
    },
    data=deploy_data,
)
try:
    with urllib.request.urlopen(deploy_req, timeout=60) as resp:
        new_deploy = json.loads(resp.read().decode())
        new_uid = new_deploy.get("uid")
        new_url = new_deploy.get("url")
        print(f"   ✓ New deployment created:")
        print(f"     UID: {new_uid}")
        print(f"     URL: https://{new_url}")
        print(f"     Inspect: https://vercel.com/{new_deploy.get('inspectorUrl', '')}")
except urllib.error.HTTPError as e:
    err_msg = e.read().decode()
    print(f"   ❌ Ошибка: {e.code} {err_msg}")
    print("   Возможно нужно trigger через git push вместо redeploy API")
    sys.exit(1)

# === 6. Сохраняем итоговый URL для cron-job.org ===
VERCEL_PRODUCTION_URL = f"https://{new_url}"
CRON_JOB_URL = f"{VERCEL_PRODUCTION_URL}/api/sniper/run?secret={CRON_SECRET}"

url_file = Path("/home/z/my-project/scripts/cron_job_url.txt")
url_file.write_text(CRON_JOB_URL + "\n")

print(f"\n=== 5. Сохранён URL для cron-job.org ===")
print(f"   File: {url_file}")
print(f"   URL:  {CRON_JOB_URL}")

print("\n" + "=" * 70)
print("🎉 УСПЕШНО:")
print("=" * 70)
print(f"  ✓ CRON_SECRET добавлен в Vercel env vars (3 окружения)")
print(f"  ✓ Запущен production redeploy (UID: {new_uid})")
print(f"  ✓ URL для cron-job.org: {VERCEL_PRODUCTION_URL}")
print()
print("📋 ЧТО ДЕЛАТЬ ДАЛЬШЕ:")
print("  1. Дождаться деплоя (~30-60 сек) — проверять статус:")
print(f"     python3 /home/z/my-project/scripts/check_vercel_deploy.py")
print("  2. Зайти на https://cron-job.org/en/  (Sign up, бесплатно)")
print("  3. Create Cron Job:")
print(f"     Title:    sniper-every-minute")
print(f"     URL:      {CRON_JOB_URL}")
print(f"     Method:   GET")
print(f"     Schedule: Every minute")
print(f"     Timeout:  60 seconds")
print("  4. Save & Start")
print("  5. Через ~10 мин в Telegram должно прийти первое Heartbeat сообщение")
print("  6. Каждый раз когда бот находит candidate — будет TG уведомление")
print("=" * 70)
