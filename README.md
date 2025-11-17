Simple Microservice Demo

What it is:
- Small example of Order + Payment using the Saga pattern and Kafka.
- Three services: Order, Payment, Saga Coordinator.

Topics:
- order-events
- payment-commands
- payment-events

Run locally:
1. Start everything:
```bash
docker compose up --build
```
2. Create an order:
```bash
curl -s -X POST http://localhost:4000/orders -H 'Content-Type: application/json' -d '{"amount": 42}'
```
3. Check order:
```bash
curl http://localhost:4000/orders/<orderId>
```
Stop:
```bash
docker compose down -v
```

If you use Kubernetes, manifests are in `k8s/`. Use `./scripts/deploy.sh` to deploy.
