#!/bin/bash
set -e

VERCEL_TOKEN="vcp_0kJmPYYZcPN1LYjPjVZtskqwfElHSZvzKO0hKQkjjc1Pm1OswD1W2QKm1Pm1OswD1W2QKm"
PROJECT_ID="prj_0XyCDQ36NzsyAGRkbu3nEt1IXXn8"
API_BASE="https://api.vercel.com"

echo "=== 1. Verify project exists ==="
PROJECT_INFO=$(curl -s --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" "$API_BASE/v9/projects/$PROJECT_ID")
PROJECT_NAME=$(echo "$PROJECT_INFO" | grep -oE '"name":"[^"]+"' | head -1)
echo "Project: $PROJECT_NAME"

# Function to set env var (idempotent — deletes if exists, then creates)
set_env_var() {
  local KEY="$1"
  local VALUE="$2"
  echo ""
  echo "=== Setting $KEY ==="
  
  # Check if already exists
  EXISTING_ID=$(curl -s --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$API_BASE/v9/projects/$PROJECT_ID/env" | \
    grep -oE "\"id\":\"[^\"]+\",\"key\":\"$KEY\"" | grep -oE '\"id\":\"[^\"]+' | head -1 | cut -d'"' -f4)
  
  if [ -n "$EXISTING_ID" ]; then
    echo "  Existing var found (id=$EXISTING_ID), deleting first..."
    curl -s --max-time 15 -X DELETE \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      "$API_BASE/v10/projects/$PROJECT_ID/env/$EXISTING_ID" > /dev/null
    sleep 1
  fi
  
  # Create new env var
  RESPONSE=$(curl -s --max-time 15 -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$KEY\",\"value\":\"$VALUE\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}" \
    "$API_BASE/v10/projects/$PROJECT_ID/env")
  
  # Check for error in response
  ERROR=$(echo "$RESPONSE" | grep -oE '"message":"[^"]+"' | head -1)
  if [ -n "$ERROR" ]; then
    echo "  ⚠️  $ERROR"
  else
    echo "  ✅ Created (encrypted, all environments)"
  fi
}

set_env_var "PIMLICO_API_KEY" "pim_VXiKbWFNUjQqKPh8x7ui4g"
set_env_var "OPENSEA_API_KEY" "3b2150459f1b4a43ac711552254cb43c"
set_env_var "SIGNER_PRIVATE_KEY" "0xf28836ed0f3d4786c13469f13254bbe80999a27c41593480968835f3d064d3af"

echo ""
echo "=== 2. Triggering redeploy ==="
# Get latest deployment
LATEST_DEPLOY=$(curl -s --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" \
  "$API_BASE/v6/deployments?projectId=$PROJECT_ID&limit=1")
DEPLOY_UID=$(echo "$LATEST_DEPLOY" | grep -oE '"uid":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "Latest deployment UID: $DEPLOY_UID"

# Redeploy
REDEPLOY_RESPONSE=$(curl -s --max-time 30 -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deploymentId":"'"$DEPLOY_UID'"}' \
  "$API_BASE/v13/deployments/$DEPLOY_UID/redeploy?forceNewBuilder=false")
NEW_DEPLOY_UID=$(echo "$REDEPLOY_RESPONSE" | grep -oE '"uid":"[^"]+"' | head -1 | cut -d'"' -f4)
NEW_DEPLOY_URL=$(echo "$REDEPLOY_RESPONSE" | grep -oE '"url":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "New deployment UID: $NEW_DEPLOY_UID"
echo "URL: $NEW_DEPLOY_URL"

echo ""
echo "=== DONE ==="
echo "Wait ~2 min for redeploy to complete, then check:"
echo "https://base-airdrop-radar.vercel.app/api/sniper/status"
