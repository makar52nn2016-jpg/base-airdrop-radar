#!/usr/bin/env python3
"""
Генерация CRON_SECRET и инструкций для настройки cron-job.org.

Этот скрипт:
1. Генерирует криптостойкий 32-байтный секрет
2. Печатает готовые команды для Vercel CLI:
   - Добавление CRON_SECRET в окружение
3. Печатает инструкции для cron-job.org (URL + параметры)

Использование:
    python3 /home/z/my-project/scripts/setup_cron_secret.py

После генерации секрета нужно добавить его в Vercel env vars:
    vercel env add CRON_SECRET
    vercel env ls
"""

import os
import secrets
import sys
from pathlib import Path

# Определяем Vercel URL
VERCEL_URL = os.environ.get("VERCEL_URL") or "https://your-vercel-app.vercel.app"

# Генерируем случайный секрет (32 байта = 64 hex chars)
CRON_SECRET = secrets.token_hex(32)

# Путь к директории со скриптом
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent

# Создаём .env.local если его нет (для локального dev)
ENV_LOCAL_PATH = PROJECT_DIR / ".env.local"
ENV_LINE = f"CRON_SECRET={CRON_SECRET}\n"

if ENV_LOCAL_PATH.exists():
    content = ENV_LOCAL_PATH.read_text()
    if "CRON_SECRET=" in content:
        # Заменяем существующее значение
        lines = content.splitlines(keepends=True)
        new_lines = [
            ENV_LINE if line.startswith("CRON_SECRET=") else line
            for line in lines
        ]
        ENV_LOCAL_PATH.write_text("".join(new_lines))
        print(f"✓ Updated CRON_SECRET in {ENV_LOCAL_PATH}")
    else:
        with open(ENV_LOCAL_PATH, "a") as f:
            f.write("\n" + ENV_LINE)
        print(f"✓ Appended CRON_SECRET to {ENV_LOCAL_PATH}")
else:
    ENV_LOCAL_PATH.write_text(ENV_LINE)
    print(f"✓ Created {ENV_LOCAL_PATH} with CRON_SECRET")

# Сохраняем в файл для последующего использования
SECRET_FILE = SCRIPT_DIR / "cron_secret.txt"
SECRET_FILE.write_text(CRON_SECRET)

# Печатаем результат
print("\n" + "=" * 70)
print("🚀 CRON SECRET СГЕНЕРИРОВАН")
print("=" * 70)
print(f"\nSECRET: {CRON_SECRET}\n")
print("=" * 70)
print("\n📋 ЧТО НУЖНО СДЕЛАТЬ ВРУЧНУЮ:\n")

print("1️⃣  ДОБАВИТЬ CRON_SECRET В VERCEL ENV VARS:")
print(f"   vercel env add CRON_SECRET production")
print(f"   value: {CRON_SECRET}")
print(f"   vercel env add CRON_SECRET preview")
print(f"   vercel env add CRON_SECRET development")
print(f"   vercel env ls  # проверить что добавлено")

print("\n2️⃣  ДЕПЛОЙ В VERCEL:")
print(f"   cd {PROJECT_DIR}")
print(f"   vercel --prod")

print("\n3️⃣  НАСТРОИТЬ CRON-JOB.ORG (КЛЮЧЕВОЙ ШАГ):")
print("   а) Зайти на https://cron-job.org/en/  → Sign up (бесплатно)")
print("   б) Create Cron Job → заполнить поля:")
print(f"      Title:    sniper-every-minute")
print(f"      URL:      {VERCEL_URL}/api/sniper/run?secret={CRON_SECRET}")
print(f"      Method:   GET")
print(f"      Schedule: Every minute  (выбрать 'Every minute' из dropdown)")
print(f"      Timeout:  60 seconds")
print(f"      Enabled:  ✓")
print("   в) Save & Start")

print("\n4️⃣  ПРОВЕРКА ЧЕРЕЗ 1-2 МИНУТЫ:")
print(f"   curl '{VERCEL_URL}/api/sniper/run?secret={CRON_SECRET}'")
print(f"   # должно вернуть JSON с scanned/candidates/results")
print(f"   # + в Telegram должно прийти '💚 Heartbeat' на 10-й минуте")

print("\n" + "=" * 70)
print("💡 АЛЬТЕРНАТИВНО: после деплоя взять URL из вывода 'vercel --prod'")
print("   и подставить в URL выше вместо your-vercel-app.vercel.app")
print("=" * 70)

# Сохраняем итоговый URL в файл для удобства
URL_FILE = SCRIPT_DIR / "cron_job_url.txt"
URL_FILE.write_text(
    f"{VERCEL_URL}/api/sniper/run?secret={CRON_SECRET}\n"
)
print(f"\n✓ URL для cron-job.org сохранён в: {URL_FILE}")
