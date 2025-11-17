#!/usr/bin/env bash
set -euo pipefail

# Simple API test script for the simple-microservice-saga-nodejs project
# Usage:
#   ./scripts/test-api.sh [local|k8s]
# Default mode is 'local' which assumes services are accessible on localhost ports 4000,4001,4002.
# Mode 'k8s' will port-forward k8s services in namespace 'saga-demo' to the same local ports (requires kubectl).

MODE=${1:-local}
NAMESPACE=${NAMESPACE:-saga-demo}

ORDER_PORT_LOCAL=4000
PAYMENT_PORT_LOCAL=4001
SAGA_PORT_LOCAL=4002

PORTFORWARDS_PIDS=()
cleanup() {
  if [ "$MODE" = "k8s" ] && [ ${#PORTFORWARDS_PIDS[@]} -gt 0 ]; then
    echo "Stopping port-forwards..."
    for pid in "${PORTFORWARDS_PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi
}
trap cleanup EXIT

have_cmd() { command -v "$1" >/dev/null 2>&1; }

jq_or_raw() {
  # $1 is JSON input on stdin, $2 is jq filter
  if have_cmd jq; then
    jq -r "$2"
  else
    # very small fallback: try grep/sed to find the value for simple cases
    sed -n 's/.*"'"$2"'"\s*:\s*"\?\([^"]*\)"\?.*/\1/p'
  fi
}

wait_for_health() {
  local host=$1
  local port=$2
  local name=$3
  local tries=0
  until curl -sS "http://$host:$port/health" >/dev/null 2>&1 || [ $tries -ge 15 ]; do
    tries=$((tries+1))
    echo "Waiting for $name health on http://$host:$port/health... ($tries)"
    sleep 1
  done
  if [ $tries -ge 15 ]; then
    echo "ERROR: $name did not respond on http://$host:$port/health"
    return 1
  fi
  echo "$name is healthy"
}

start_port_forwards() {
  echo "Starting kubectl port-forwards in background (namespace: $NAMESPACE)"
  kubectl port-forward -n "$NAMESPACE" svc/order-service ${ORDER_PORT_LOCAL}:4000 >/dev/null 2>&1 &
  PORTFORWARDS_PIDS+=("$!")
  kubectl port-forward -n "$NAMESPACE" svc/payment-service ${PAYMENT_PORT_LOCAL}:4001 >/dev/null 2>&1 &
  PORTFORWARDS_PIDS+=("$!")
  kubectl port-forward -n "$NAMESPACE" svc/saga-coordinator ${SAGA_PORT_LOCAL}:4002 >/dev/null 2>&1 &
  PORTFORWARDS_PIDS+=("$!")
}

# Main
if [ "$MODE" = "k8s" ]; then
  if ! have_cmd kubectl; then
    echo "kubectl not found in PATH. Install kubectl or run in 'local' mode."
    exit 2
  fi
  start_port_forwards
  # give a moment for port-forward to establish
  sleep 1
fi

ORDER_HOST=localhost
PAYMENT_HOST=localhost
SAGA_HOST=localhost

# 1) Check health endpoints
wait_for_health "$ORDER_HOST" $ORDER_PORT_LOCAL "order-service"
wait_for_health "$PAYMENT_HOST" $PAYMENT_PORT_LOCAL "payment-service"
wait_for_health "$SAGA_HOST" $SAGA_PORT_LOCAL "saga-coordinator"

# 2) Create an order and poll for its final status
echo "Creating a test order (amount=42)..."
create_resp=$(curl -sS -X POST "http://$ORDER_HOST:$ORDER_PORT_LOCAL/orders" \
  -H 'Content-Type: application/json' \
  -d '{"amount":42}') || { echo "Failed to create order"; exit 3; }

orderId=""
if have_cmd jq; then
  orderId=$(echo "$create_resp" | jq -r '.orderId // empty')
else
  # naive parse
  orderId=$(echo "$create_resp" | sed -n 's/.*"orderId"\s*:\s*"\([^"]*\)".*/\1/p')
fi

if [ -z "$orderId" ]; then
  echo "Failed to parse orderId from response: $create_resp"
  exit 4
fi

echo "Created order: $orderId — polling status..."

max_tries=30
i=0
final_json=""
while [ $i -lt $max_tries ]; do
  sleep 1
  i=$((i+1))
  resp=$(curl -sS "http://$ORDER_HOST:$ORDER_PORT_LOCAL/orders/$orderId" || true)
  if [ -z "$resp" ]; then
    echo "No response yet for order (attempt $i)..."
    continue
  fi
  # extract status
  status=""
  if have_cmd jq; then
    status=$(echo "$resp" | jq -r '.status // empty')
  else
    status=$(echo "$resp" | sed -n 's/.*"status"\s*:\s*"\([^"]*\)".*/\1/p')
  fi
  echo "Attempt $i: status=$status"
  if [ "$status" = "completed" ] || [ "$status" = "cancelled" ]; then
    final_json="$resp"
    break
  fi
done

if [ -z "$final_json" ]; then
  echo "Order did not reach completed/cancelled after $max_tries seconds. Last response:"
  echo "$resp"
  exit 5
fi

echo "Final order status:"
echo "$final_json" | (have_cmd jq && jq . || cat)

echo "API smoke tests passed (order processed)."

# cleanup will run via trap
exit 0
