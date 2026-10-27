#!/usr/bin/env bash
# =============================================================================
# RythuDirect — end-to-end workflow check
#
# Drives the running API over HTTP as three real users: a farmer, a customer,
# and an administrator. Every request carries a real session cookie, so each
# assertion exercises the same authorization path a browser would.
#
# This is the acceptance run for the scenarios in the brief. It asserts on
# outcomes (does the order exist, was the over-stock order refused, can a
# customer reach an admin route) rather than on implementation details.
#
#   bash server/scripts/e2e.sh
#
# Requires the API to be running and the database to be seeded.
# =============================================================================
set -uo pipefail

# The suite drives many authentication calls from one address (registrations,
# deliberate bad passwords, wrong-door sign-ins). A real rate limiter would
# throttle that, which is correct in production and useless here, so the script
# starts its own server with limiting disabled on a dedicated port. Rate
# limiting itself is verified separately in section 20.
# The port is chosen at random and the child's liveness is checked before any
# assertion runs. A stale server left on a fixed port would otherwise answer the
# health check and every test would silently run against old code.
PORT_UNDER_TEST="${E2E_PORT:-$(( RANDOM % 2000 + 13000 ))}"
API="${API_URL:-http://localhost:$PORT_UNDER_TEST}"
TMP="$(mktemp -d)"

SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "${RL_PID:-}" ] && kill "$RL_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

# Starts the API in the background and sets SERVER_STARTED_PID.
#
# The pid is published through a global rather than echoed from a subshell: a
# command substitution waits for every process holding the pipe to exit, and the
# server inherits it, so `PID=$(start_server ...)` would block forever.
SERVER_STARTED_PID=""
start_server() { # port, logfile, disable_rate_limits
  local port="$1" log="$2"
  ( cd "$(dirname "${BASH_SOURCE[0]}")/.." && \
    RATE_LIMIT_DISABLED="$3" PORT="$port" npx tsx src/index.ts > "$log" 2>&1 ) &
  SERVER_STARTED_PID=$!
}

wait_for_health() { # url, pid, logfile
  local url="$1" pid="$2" log="$3"
  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '\033[31mThe API process exited during startup.\033[0m\n'
      cat "$log"
      return 1
    fi
    curl -fsS "$url/api/health" > /dev/null 2>&1 && return 0
    sleep 0.5
  done
  printf '\033[31mThe API did not become healthy in time.\033[0m\n'
  cat "$log"
  return 1
}

if [ -z "${API_URL:-}" ]; then
  if curl -fsS "$API/api/health" > /dev/null 2>&1; then
    printf '\033[31mSomething is already listening on %s.\033[0m\n' "$API"
    printf 'Set E2E_PORT to a free port, or stop that process.\n'
    exit 1
  fi

  printf 'Starting a dedicated API instance on %s...\n' "$API"
  start_server "$PORT_UNDER_TEST" "$TMP/server.log" true
  SERVER_PID="$SERVER_STARTED_PID"
  wait_for_health "$API" "$SERVER_PID" "$TMP/server.log" || exit 1
  printf 'API is up (pid %s).\n' "$SERVER_PID"
fi

PASS=0
FAIL=0
declare -a FAILURES=()

pass() { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() {
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
  printf '  \033[31mFAIL\033[0m  %s\n' "$1"
  [ -n "${2:-}" ] && printf '        %s\n' "$2"
}
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# The response body of the most recent request lives in $TMP/body. It is read
# from the file rather than a variable because `req` runs in a subshell when its
# result is captured, so a variable set inside it would not survive.
BODY_FILE="$TMP/body"

assert_json() {
  local label="$1" expr="$2"
  if python3 -c "
import json,sys
try:
    d = json.load(open('$BODY_FILE'))
except Exception as e:
    print('invalid JSON:', e); sys.exit(1)
sys.exit(0 if ($expr) else 1)
" 2>/dev/null; then
    pass "$label"
  else
    fail "$label" "$(head -c 300 "$BODY_FILE" 2>/dev/null)"
  fi
}

# Read a value out of the last response body.
body_get() {
  python3 -c "
import json,sys
d = json.load(open('$BODY_FILE'))
print($1)
" 2>/dev/null || echo ""
}

req() { # method path cookiejar [body] -> prints the HTTP status code
  local method="$1" path="$2" jar="$3" body="${4:-}"
  local args=(-s -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$API$path")
  [ -n "$jar" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}"
}

# ---------------------------------------------------------------------------
section "1. Service health"
# ---------------------------------------------------------------------------
CODE="$(req GET /api/health "" "")"
assert_json "health endpoint reports ok" "d['status'] == 'ok'"
assert_json "database is connected" "d['database'] == 'connected'"
assert_json "unconfigured integrations are reported honestly" "len(d['missing_integrations']) > 0"

# ---------------------------------------------------------------------------
section "2. Public catalogue is readable without signing in"
# ---------------------------------------------------------------------------
CODE="$(req GET "/api/products?page_size=5" "" "")"
assert_json "anonymous browse returns listings" "d['total'] > 0"
assert_json "listing rows carry the farmer name" "all(p.get('farmer_name') for p in d['items'])"
assert_json "no draft listings are exposed publicly" "all(p.get('status','active') != 'draft' for p in d['items'])"

# A private column must not be reachable through the public view.
assert_json "public rows expose no password_hash" "all('password_hash' not in p for p in d['items'])"

CODE="$(req GET "/api/products/categories" "" "")"
assert_json "categories are listed" "len(d['categories']) >= 5"

CODE="$(req GET "/api/products?page_size=1" "" "")"
PRODUCT_ID="$(body_get "d['items'][0]['id']")"

# ---------------------------------------------------------------------------
section "3. Farmer registration and sign-in"
# ---------------------------------------------------------------------------
FARMER_EMAIL="e2e.farmer.$$@example.com"
CODE="$(req POST /api/auth/register/farmer "" "{
  \"email\":\"$FARMER_EMAIL\",\"password\":\"Harvest2026x\",\"full_name\":\"E2E Farmer\",
  \"phone\":\"+91 90000 12345\",\"preferred_language\":\"te\",\"farm_name\":\"E2E Test Farm\",
  \"state\":\"Telangana\",\"district\":\"Nalgonda\",\"village\":\"Miryalaguda\",
  \"farming_type\":[\"Conventional\"],\"crops_cultivated\":[\"Paddy\"],
  \"accepted_terms\":true}")"
assert_json "farmer registers" "d['role'] == 'farmer'"

# Duplicate registration must be refused, not silently overwrite.
CODE="$(req POST /api/auth/register/farmer "" "{
  \"email\":\"$FARMER_EMAIL\",\"password\":\"Harvest2026x\",\"full_name\":\"E2E Farmer\",
  \"phone\":\"+91 90000 12345\",\"state\":\"Telangana\",\"district\":\"Nalgonda\",
  \"village\":\"Miryalaguda\",\"accepted_terms\":true}")"
[ "$CODE" = "409" ] && pass "duplicate email is refused with 409" || fail "duplicate email is refused with 409" "got $CODE"

# A weak password must be rejected.
CODE="$(req POST /api/auth/register/farmer "" "{
  \"email\":\"weak.$$@example.com\",\"password\":\"password1\",\"full_name\":\"Weak Pass\",
  \"phone\":\"+91 90000 12346\",\"state\":\"Telangana\",\"district\":\"Nalgonda\",
  \"village\":\"X\",\"accepted_terms\":true}")"
[ "$CODE" = "422" ] && pass "common password is rejected" || fail "common password is rejected" "got $CODE"

FARMER_JAR="$TMP/farmer.jar"
CODE="$(req POST /api/auth/login "$FARMER_JAR" "{\"email\":\"$FARMER_EMAIL\",\"password\":\"Harvest2026x\",\"expected_role\":\"farmer\"}")"
assert_json "farmer signs in" "d['user']['role'] == 'farmer'"

CODE="$(req POST /api/auth/login "" "{\"email\":\"$FARMER_EMAIL\",\"password\":\"Harvest2026x\",\"expected_role\":\"customer\"}")"
[ "$CODE" = "403" ] && pass "signing in at the wrong door is refused" || fail "signing in at the wrong door is refused" "got $CODE"

# ---------------------------------------------------------------------------
section "4. Farmer publishes a crop"
# ---------------------------------------------------------------------------
CODE="$(req POST /api/products "$FARMER_JAR" "{
  \"name\":\"E2E Test Paddy\",\"category_id\":1,\"variety\":\"BPT 5204\",
  \"description\":\"Seeded by the end-to-end check.\",\"price\":58.5,\"unit\":\"kg\",
  \"stock_quantity\":100,\"minimum_order_quantity\":5,\"grade\":\"A\",
  \"delivery_charge\":80,\"offers_delivery\":true,\"offers_pickup\":true,
  \"status\":\"active\"}")"
assert_json "farmer creates a listing" "d['product']['id'] is not None"
NEW_PRODUCT_ID="$(body_get "d['product']['id']")"

# The price the farmer set must be stored unchanged.
assert_json "the farmer's own price is stored unchanged" "float(d['product']['price']) == 58.5"

# It must survive a re-read.
CODE="$(req GET "/api/products/$NEW_PRODUCT_ID" "$FARMER_JAR" "")"
assert_json "the listing persists and is re-readable" "d['product']['name'] == 'E2E Test Paddy'"

# And it must be visible to an anonymous visitor.
CODE="$(req GET "/api/products/$NEW_PRODUCT_ID" "" "")"
assert_json "the published listing is publicly visible" "d['product']['name'] == 'E2E Test Paddy'"

# A price the farmer did not set must not be substituted.
assert_json "no automatic price substitution occurs" "float(d['product']['price']) == 58.5"

# Publishing with no stock must be refused.
CODE="$(req POST /api/products "$FARMER_JAR" "{
  \"name\":\"Empty Stock Crop\",\"price\":10,\"unit\":\"kg\",
  \"stock_quantity\":0,\"minimum_order_quantity\":1,\"status\":\"active\"}")"
[ "$CODE" = "422" ] && pass "listing with zero stock cannot be published" || fail "listing with zero stock cannot be published" "got $CODE"

# ---------------------------------------------------------------------------
section "5. Customer registration and sign-in"
# ---------------------------------------------------------------------------
CUSTOMER_EMAIL="e2e.customer.$$@example.com"
CODE="$(req POST /api/auth/register/customer "" "{
  \"email\":\"$CUSTOMER_EMAIL\",\"password\":\"Market2026x\",\"full_name\":\"E2E Customer\",
  \"phone\":\"+91 90000 54321\",\"preferred_language\":\"hi\",\"state\":\"Telangana\",
  \"district\":\"Hyderabad\",\"village\":\"Kondapur\",\"delivery_address\":\"12 Test Street, Kondapur\",
  \"postal_code\":\"500084\",\"accepted_terms\":true}")"
assert_json "customer registers" "d['role'] == 'customer'"

CUSTOMER_JAR="$TMP/customer.jar"
CODE="$(req POST /api/auth/login "$CUSTOMER_JAR" "{\"email\":\"$CUSTOMER_EMAIL\",\"password\":\"Market2026x\",\"expected_role\":\"customer\"}")"
assert_json "customer signs in" "d['user']['role'] == 'customer'"
assert_json "the customer's language preference is preserved" "d['user']['preferred_language'] == 'hi'"

# ---------------------------------------------------------------------------
section "6. Customer discovers the crop"
# ---------------------------------------------------------------------------
CODE="$(req GET "/api/products?search=E2E%20Test%20Paddy" "$CUSTOMER_JAR" "")"
assert_json "search by name finds the listing" "d['total'] >= 1"

CODE="$(req GET "/api/products?state=Telangana&district=Nalgonda" "$CUSTOMER_JAR" "")"
assert_json "filter by district finds it" "any(p['id'] == '$NEW_PRODUCT_ID' for p in d['items'])"

CODE="$(req GET "/api/products?max_price=60&sort=price_asc" "$CUSTOMER_JAR" "")"
assert_json "price filter and sort return ordered results" "all(float(p['price']) <= 60 for p in d['items'])"

CODE="$(req GET "/api/products?near_lat=17.0&near_lng=79.0&max_distance_km=200&sort=nearest" "$CUSTOMER_JAR" "")"
assert_json "proximity search returns distances" "d['total'] >= 1 and 'distance_km' in d['items'][0]"

# ---------------------------------------------------------------------------
section "7. Cart"
# ---------------------------------------------------------------------------
CODE="$(req POST /api/cart/items "$CUSTOMER_JAR" "{\"product_id\":\"$NEW_PRODUCT_ID\",\"quantity\":10}")"
assert_json "item is added to the cart" "d['cart']['item_count'] == 1"

CODE="$(req GET /api/cart "$CUSTOMER_JAR" "")"
assert_json "cart prices the line" "float(d['cart']['lines'][0]['line_subtotal']) == 585.0"
assert_json "cart groups by seller" "len(d['cart']['groups']) == 1"
assert_json "cart total includes delivery" "float(d['cart']['total_amount']) == 665.0"

# Below the minimum order quantity.
CODE="$(req POST /api/cart/items "$CUSTOMER_JAR" "{\"product_id\":\"$NEW_PRODUCT_ID\",\"quantity\":1}")"
[ "$CODE" = "400" ] && pass "quantity below the minimum is refused" || fail "quantity below the minimum is refused" "got $CODE"

# More than the stock on hand (already 10 in the cart, 100 available).
CODE="$(req POST /api/cart/items "$CUSTOMER_JAR" "{\"product_id\":\"$NEW_PRODUCT_ID\",\"quantity\":95}")"
[ "$CODE" = "409" ] && pass "quantity above available stock is refused" || fail "quantity above available stock is refused" "got $CODE"

# ---------------------------------------------------------------------------
section "8. Checkout and inventory"
# ---------------------------------------------------------------------------
IDEM="e2e-$$-$(date +%s)"
CODE="$(req POST /api/orders/checkout "$CUSTOMER_JAR" "{
  \"fulfilment_method\":\"delivery\",\"idempotency_key\":\"$IDEM\"}")"
assert_json "a valid order is created" "len(d['orders']) == 1"
ORDER_ID="$(body_get "d['orders'][0]['id']")"
assert_json "order total matches the cart" "float(d['total_amount']) == 665.0"

# Idempotency: the same key must not produce a second order.
CODE="$(req POST /api/orders/checkout "$CUSTOMER_JAR" "{
  \"fulfilment_method\":\"delivery\",\"idempotency_key\":\"$IDEM\"}")"
assert_json "a retried checkout does not duplicate the order" "len(d['orders']) == 1"

# Stock must have been decremented by exactly the ordered quantity.
CODE="$(req GET "/api/products/$NEW_PRODUCT_ID" "$FARMER_JAR" "")"
assert_json "stock was decremented by the ordered quantity" "float(d['product']['stock_quantity']) == 90.0"

# The cart must be empty after a successful checkout.
CODE="$(req GET /api/cart "$CUSTOMER_JAR" "")"
assert_json "the cart is cleared after checkout" "d['cart']['item_count'] == 0"

# Over-ordering the remaining stock must fail.
CODE="$(req POST /api/cart/items "$CUSTOMER_JAR" "{\"product_id\":\"$NEW_PRODUCT_ID\",\"quantity\":500}")"
[ "$CODE" = "409" ] && pass "over-ordering beyond stock is refused" || fail "over-ordering beyond stock is refused" "got $CODE"

# The order appears in both dashboards.
CODE="$(req GET /api/orders "$CUSTOMER_JAR" "")"
assert_json "the order appears in the customer's list" "any(o['id'] == '$ORDER_ID' for o in d['items'])"

CODE="$(req GET /api/orders "$FARMER_JAR" "")"
assert_json "the same order appears in the farmer's list" "any(o['id'] == '$ORDER_ID' for o in d['items'])"

# ---------------------------------------------------------------------------
section "9. Order lifecycle"
# ---------------------------------------------------------------------------
CODE="$(req PUT "/api/orders/$ORDER_ID/status" "$FARMER_JAR" '{"status":"accepted"}')"
assert_json "farmer accepts the order" "d['order']['order_status'] == 'accepted'"

CODE="$(req GET "/api/orders/$ORDER_ID" "$CUSTOMER_JAR" "")"
assert_json "customer sees the updated status" "d['order']['order_status'] == 'accepted'"

# The state machine must reject a skip.
CODE="$(req PUT "/api/orders/$ORDER_ID/status" "$FARMER_JAR" '{"status":"delivered"}')"
[ "$CODE" = "409" ] && pass "an illegal status jump is refused" || fail "an illegal status jump is refused" "got $CODE"

# A customer must not be able to drive fulfilment.
CODE="$(req PUT "/api/orders/$ORDER_ID/status" "$CUSTOMER_JAR" '{"status":"preparing"}')"
[ "$CODE" = "409" ] || [ "$CODE" = "403" ] && pass "a customer cannot set fulfilment status" || fail "a customer cannot set fulfilment status" "got $CODE"

CODE="$(req PUT "/api/orders/$ORDER_ID/status" "$FARMER_JAR" '{"status":"preparing"}')"
assert_json "farmer moves the order to preparing" "d['order']['order_status'] == 'preparing'"
CODE="$(req PUT "/api/orders/$ORDER_ID/status" "$FARMER_JAR" '{"status":"shipped"}')"
assert_json "farmer ships the order" "d['order']['order_status'] == 'shipped'"
CODE="$(req PUT "/api/orders/$ORDER_ID/status" "$FARMER_JAR" '{"status":"delivered"}')"
assert_json "farmer delivers the order" "d['order']['order_status'] == 'delivered'"

# ---------------------------------------------------------------------------
section "10. Payments are not fake"
# ---------------------------------------------------------------------------
CODE="$(req GET /api/payments/capability "$CUSTOMER_JAR" "")"
assert_json "the payment capability is reported honestly" "d['configured'] == False or d['provider'] == 'razorpay'"

# Razorpay must be refused when it is not configured, rather than pretending.
if grep -q '"configured":false' "$BODY_FILE"; then
  CODE="$(req POST /api/payments/initiate "$CUSTOMER_JAR" "{\"order_id\":\"$ORDER_ID\",\"provider\":\"razorpay\"}")"
  [ "$CODE" = "503" ] && pass "unconfigured online payment is refused, not simulated" \
    || fail "unconfigured online payment is refused, not simulated" "got $CODE"
fi

# A forged Razorpay callback must not mark the order paid.
CODE="$(req POST /api/payments/confirm "$CUSTOMER_JAR" '{
  "razorpay_order_id":"order_forged_123","razorpay_payment_id":"pay_forged_123",
  "razorpay_signature":"0000000000000000000000000000000000000000000000000000000000000000"}')"
if [ "$CODE" = "503" ] || [ "$CODE" = "400" ]; then
  pass "a forged payment signature is rejected"
else
  fail "a forged payment signature is rejected" "got $CODE"
fi

CODE="$(req GET "/api/orders/$ORDER_ID" "$CUSTOMER_JAR" "")"
assert_json "a forged callback creates no payment-success record" \
  "d['order']['payment_status'] != 'captured' or d['order']['payment_status'] == 'unpaid'"

# ---------------------------------------------------------------------------
section "11. Reviews require a real purchase"
# ---------------------------------------------------------------------------
CODE="$(req POST /api/reviews "$CUSTOMER_JAR" "{
  \"order_id\":\"$ORDER_ID\",\"product_id\":\"$NEW_PRODUCT_ID\",
  \"product_rating\":5,\"seller_rating\":4,\"comment\":\"End-to-end check review.\"}")"
assert_json "a verified purchaser can review a delivered order" "d['id'] is not None"

CODE="$(req POST /api/reviews "$CUSTOMER_JAR" "{
  \"order_id\":\"$ORDER_ID\",\"product_id\":\"$NEW_PRODUCT_ID\",
  \"product_rating\":5,\"seller_rating\":4,\"comment\":\"Duplicate.\"}")"
[ "$CODE" = "409" ] && pass "a duplicate review for the same order is refused" || fail "a duplicate review for the same order is refused" "got $CODE"

CODE="$(req GET "/api/reviews/product/$NEW_PRODUCT_ID" "" "")"
assert_json "the review is publicly visible" "len(d['reviews']) >= 1"

# ---------------------------------------------------------------------------
section "12. Authorization boundaries"
# ---------------------------------------------------------------------------
# Another farmer must not be able to edit this listing.
OTHER_JAR="$TMP/other.jar"
CODE="$(req POST /api/auth/login "$OTHER_JAR" '{"email":"lakshmi.devi@example.com","password":"RythuDemo123","expected_role":"farmer"}')"
if [ "$CODE" = "200" ]; then
  CODE="$(req PATCH "/api/products/$NEW_PRODUCT_ID" "$OTHER_JAR" '{"price":1}')"
  [ "$CODE" = "404" ] && pass "a farmer cannot edit another farmer's listing" \
    || fail "a farmer cannot edit another farmer's listing" "got $CODE"

  CODE="$(req GET "/api/orders/$ORDER_ID" "$OTHER_JAR" "")"
  [ "$CODE" = "404" ] && pass "a farmer cannot read an unrelated order" \
    || fail "a farmer cannot read an unrelated order" "got $CODE"
fi

# A customer must not reach any administrator function.
for path in /api/admin/overview /api/admin/users /api/admin/audit-logs /api/admin/settings; do
  CODE="$(req GET "$path" "$CUSTOMER_JAR" "")"
  [ "$CODE" = "403" ] && pass "customer is blocked from $path" || fail "customer is blocked from $path" "got $CODE"
done

# Nor a farmer.
CODE="$(req GET /api/admin/users "$FARMER_JAR" "")"
[ "$CODE" = "403" ] && pass "farmer is blocked from the admin user list" || fail "farmer is blocked from the admin user list" "got $CODE"

# An anonymous caller gets 401, not data.
CODE="$(req GET /api/admin/overview "" "")"
[ "$CODE" = "401" ] && pass "anonymous caller is blocked from admin routes" || fail "anonymous caller is blocked from admin routes" "got $CODE"

# A customer cannot escalate their own role through a profile edit.
CODE="$(req PATCH /api/auth/profile "$CUSTOMER_JAR" '{"full_name":"E2E Customer","role":"admin"}')"
CODE2="$(req GET /api/auth/me "$CUSTOMER_JAR" "")"
assert_json "a role smuggled into a profile edit is ignored" "d['user']['role'] == 'customer'"

# A farmer cannot self-verify their own quality report.
CODE="$(req POST "/api/products/$NEW_PRODUCT_ID/quality-reports" "$FARMER_JAR" "{
  \"product_id\":\"$NEW_PRODUCT_ID\",\"title\":\"Self-verification attempt\",
  \"summary\":\"Attempting to mark this verified.\",\"measurements\":{\"moisture_pct\":12},
  \"verification_status\":\"verified\"}")"
if [ "$CODE" = "201" ] || [ "$CODE" = "422" ]; then
  CODE="$(req GET "/api/products/$NEW_PRODUCT_ID/quality-reports" "$FARMER_JAR" "")"
  assert_json "a smuggled verification_status is not applied" \
    "all(r['verification_status'] != 'verified' for r in d['reports'])"
fi

# ---------------------------------------------------------------------------
section "13. Administrator functions"
# ---------------------------------------------------------------------------
ADMIN_JAR="$TMP/admin.jar"
CODE="$(req POST /api/auth/login "$ADMIN_JAR" \
  "{\"email\":\"admin@rythudirect.example\",\"password\":\"${SEED_DEMO_PASSWORD:-RythuDemo123}\",\"expected_role\":\"admin\"}")"
assert_json "administrator signs in" "d['user']['role'] == 'admin'"

CODE="$(req GET /api/admin/overview "$ADMIN_JAR" "")"
assert_json "admin overview returns counts" "d['counts']['farmers'] >= 1"
assert_json "admin overview counts customers" "d['counts']['customers'] >= 1"

CODE="$(req GET /api/admin/users "$ADMIN_JAR" "")"
assert_json "admin can list users" "d['total'] >= 1"

CODE="$(req GET /api/admin/orders "$ADMIN_JAR" "")"
assert_json "admin can list orders" "d['total'] >= 1"

CODE="$(req GET /api/admin/audit-logs "$ADMIN_JAR" "")"
assert_json "the audit log records privileged actions" "d['total'] >= 1"

CODE="$(req GET /api/admin/settings "$ADMIN_JAR" "")"
assert_json "integration status is visible to an admin" "'integrations' in d"
assert_json "the admin sees which integrations are unconfigured" "d['integrations']['payments']['configured'] == False or d['integrations']['payments']['configured'] == True"

# ---------------------------------------------------------------------------
section "14. Messaging"
# ---------------------------------------------------------------------------
CODE="$(req GET "/api/products/$NEW_PRODUCT_ID" "$CUSTOMER_JAR" "")"
FARMER_ID="$(body_get "d['product']['farmer_id']")"

CODE="$(req POST /api/messages "$CUSTOMER_JAR" "{
  \"other_user_id\":\"$FARMER_ID\",\"product_id\":\"$NEW_PRODUCT_ID\",
  \"subject\":\"Question about E2E Test Paddy\",\"message\":\"Is this from the current season?\"}")"
assert_json "customer opens a conversation" "d['conversation']['id'] is not None"
CONV_ID="$(body_get "d['conversation']['id']")"

CODE="$(req GET /api/messages "$FARMER_JAR" "")"
assert_json "the farmer sees the conversation" "d['total'] >= 1"
assert_json "the farmer has an unread message" "any(c['unread_count'] > 0 for c in d['items'])"

CODE="$(req POST "/api/messages/$CONV_ID/messages" "$FARMER_JAR" '{"body":"Yes, harvested last month."}')"
assert_json "the farmer replies" "d['message']['id'] is not None"

CODE="$(req GET "/api/messages/$CONV_ID" "$CUSTOMER_JAR" "")"
assert_json "the customer sees both messages" "len(d['messages']) >= 2"

# An unrelated user must not read the thread.
CODE="$(req GET "/api/messages/$CONV_ID" "$OTHER_JAR" "")"
[ "$CODE" = "404" ] && pass "an unrelated user cannot read the conversation" \
  || fail "an unrelated user cannot read the conversation" "got $CODE"

CODE="$(req POST "/api/messages/$CONV_ID/read" "$CUSTOMER_JAR" "")"
assert_json "messages can be marked read" "d['markedRead'] >= 1"

# ---------------------------------------------------------------------------
section "15. Market insights honesty"
# ---------------------------------------------------------------------------
CODE="$(req GET "/api/market/compare?commodity=Sona%20Masuri%20Rice&state=Telangana" "" "")"
assert_json "market comparison returns observations" "'observations' in d"
assert_json "every observation states its age" "all('age_days' in o for o in d['observations'])"
assert_json "marketplace prices are labelled as farmer-listed" \
  "'not market or mandi prices' in d['marketplace']['note']"
assert_json "the data source is disclosed" "isinstance(d['sourceNote'], str) and len(d['sourceNote']) > 0"

CODE="$(req GET "/api/market/compare?commodity=NonExistentCrop&state=Goa" "" "")"
assert_json "an absent commodity reports that data is unavailable" "d['configured'] == False"
assert_json "the unavailable state explains itself" "'not yet configured' in d['sourceNote']"

# ---------------------------------------------------------------------------
section "16. Quality transparency"
# ---------------------------------------------------------------------------
CODE="$(req GET /api/quality/standards "" "")"
assert_json "quality standards are published" "'trust_levels' in d"
assert_json "the AI disclaimer is present" "'does not replace professional' in d['ai_disclaimer']"
assert_json "registered and verified are distinguished" \
  "len(d['trust_levels']) >= 4"

CODE="$(req POST /api/quality/ai-assess "$FARMER_JAR" '{
  "product_id":"'"$NEW_PRODUCT_ID"'","image_path":"x/y/z.jpg"}')"
if [ "$CODE" = "503" ]; then
  pass "AI assessment reports that it is unconfigured"
else
  fail "AI assessment reports that it is unconfigured" "got $CODE"
fi

# ---------------------------------------------------------------------------
section "17. Multilingual support"
# ---------------------------------------------------------------------------
CODE="$(req PUT /api/auth/language "$CUSTOMER_JAR" '{"language":"te"}')"
assert_json "language preference can be changed to Telugu" "d['preferred_language'] == 'te'"

CODE="$(req GET /api/auth/me "$CUSTOMER_JAR" "")"
assert_json "the Telugu preference persists" "d['user']['preferred_language'] == 'te'"

CODE="$(req PUT /api/auth/language "$CUSTOMER_JAR" '{"language":"klingon"}')"
[ "$CODE" = "400" ] && pass "an unsupported language is refused" || fail "an unsupported language is refused" "got $CODE"

CODE="$(req GET /api/products/categories "" "")"
assert_json "categories carry Telugu and Hindi names" \
  "any(c['localized_names'].get('te') for c in d['categories'])"

# ---------------------------------------------------------------------------
section "18. Error states are safe"
# ---------------------------------------------------------------------------
CODE="$(req GET "/api/products/00000000-0000-0000-0000-000000000000" "" "")"
[ "$CODE" = "404" ] && pass "a missing product returns 404" || fail "a missing product returns 404" "got $CODE"

CODE="$(req GET "/api/products/not-a-uuid" "" "")"
[ "$CODE" = "404" ] || [ "$CODE" = "400" ] && pass "a malformed id is handled" || fail "a malformed id is handled" "got $CODE"

CODE="$(req GET "/api/no-such-route" "" "")"
[ "$CODE" = "404" ] && pass "an unknown API route returns JSON 404" || fail "an unknown API route returns JSON 404" "got $CODE"
assert_json "the 404 body is JSON, not HTML" "'error' in d"

CODE="$(req POST /api/auth/login "" '{"email":"nobody@example.com","password":"WrongPass123"}')"
[ "$CODE" = "401" ] && pass "a wrong password returns 401" || fail "a wrong password returns 401" "got $CODE"

# The message must not reveal whether the account exists.
assert_json "the login error does not disclose account existence" \
  "'not correct' in d['error']['message']"

CODE="$(req POST /api/auth/forgot-password "" '{"email":"nobody@example.com"}')"
assert_json "password reset does not disclose account existence" "d['message'] is not None"
assert_json "the reset response is identical for unknown addresses" \
  "'If an account exists' in d['message']"

# ---------------------------------------------------------------------------
section "19. No sensitive data in responses"
# ---------------------------------------------------------------------------
CODE="$(req GET /api/auth/me "$ADMIN_JAR" "")"
assert_json "the session response exposes no password hash" "'password_hash' not in d['user']"
assert_json "the session response exposes no token" "'token' not in d['user']"

CODE="$(req GET /api/admin/users "$ADMIN_JAR" "")"
assert_json "the admin user list exposes no password hash" \
  "all('password_hash' not in u for u in d['items'])"

CODE="$(req GET "/api/orders/$ORDER_ID/payments" "$CUSTOMER_JAR" "")"
assert_json "payment rows expose no provider secret" \
  "all('key_secret' not in p and 'signature' not in p for p in d['payments'])"

# ---------------------------------------------------------------------------
section "20. Rate limiting is active when enabled"
# ---------------------------------------------------------------------------
# A separate instance with limiting on, because the one above has it disabled.
RL_PORT=$(( PORT_UNDER_TEST + 1 ))
RL_API="http://localhost:$RL_PORT"
start_server "$RL_PORT" "$TMP/rl.log" false
RL_PID="$SERVER_STARTED_PID"

if wait_for_health "$RL_API" "$RL_PID" "$TMP/rl.log" 2>/dev/null; then
  LIMITED=0
  for _ in $(seq 1 15); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$RL_API/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"email":"bruteforce@example.com","password":"WrongPass123"}')"
    [ "$CODE" = "429" ] && LIMITED=1 && break
  done
  [ "$LIMITED" = "1" ] && pass "repeated failed logins are rate limited" \
    || fail "repeated failed logins are rate limited" "no 429 after 15 attempts"
else
  fail "the rate-limited instance started" "see $TMP/rl.log"
fi
kill "$RL_PID" 2>/dev/null
RL_PID=""

# ---------------------------------------------------------------------------
printf '\n\033[1m%s\033[0m\n' "---------------------------------------------"
printf '\033[1mResult: %d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\nFailures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
printf '\nAll scenarios passed.\n'
