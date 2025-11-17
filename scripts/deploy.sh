#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="saga-demo"
MANIFEST_DIR="$(dirname "$0")/../k8s"

echo "[deploy] Applying namespace"
kubectl apply -f "$MANIFEST_DIR/namespace.yaml"

echo "[deploy] Deploying Kafka"
kubectl apply -f "$MANIFEST_DIR/kafka.yaml"

echo "[deploy] Deploying Order Service"
kubectl apply -f "$MANIFEST_DIR/order-service.yaml"

echo "[deploy] Deploying Payment Service"
kubectl apply -f "$MANIFEST_DIR/payment-service.yaml"

echo "[deploy] Deploying Saga Coordinator"
kubectl apply -f "$MANIFEST_DIR/saga-coordinator.yaml"

echo "[deploy] Waiting for deployments to finish rolling out (this may take a few minutes)..."
# Use rollout status on deployments which is more robust than waiting for pod conditions by label.
# Increase timeout to 120s to give Kafka and services extra time to start.
kubectl -n "$NAMESPACE" rollout status deployment/kafka --timeout=120s || true
kubectl -n "$NAMESPACE" rollout status deployment/order-service --timeout=120s || true
kubectl -n "$NAMESPACE" rollout status deployment/payment-service --timeout=120s || true
kubectl -n "$NAMESPACE" rollout status deployment/saga-coordinator --timeout=120s || true

echo "[deploy] Listing services:"
kubectl get svc -n "$NAMESPACE"

echo "[deploy] Done. Forward ports to access services locally, e.g.:"
echo "kubectl port-forward svc/order-service 4000:4000 -n $NAMESPACE" 
echo "kubectl port-forward svc/payment-service 4001:4001 -n $NAMESPACE" 
echo "kubectl port-forward svc/saga-coordinator 4002:4002 -n $NAMESPACE" 
