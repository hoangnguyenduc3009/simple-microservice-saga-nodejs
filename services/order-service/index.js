const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 4000;
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

const kafka = new Kafka({
  clientId: 'order-service',
  brokers: [KAFKA_BROKER],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'order-service-group' });

const ORDER_EVENTS = 'order-events';

// In-memory order store
const orders = new Map();

async function startKafka() {
  // Connect producer and consumer with simple retry
  let attempts = 0;
  while (attempts < 20) {
    try {
      await producer.connect();
      await consumer.connect();
      await consumer.subscribe({ topic: ORDER_EVENTS, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const payload = JSON.parse(message.value.toString());
            if (!payload || !payload.type) return;

            if (payload.type === 'OrderCompleted') {
              const ord = orders.get(payload.orderId);
              if (ord) {
                ord.status = 'completed';
                ord.updatedAt = new Date().toISOString();
              }
              console.log(`[Order Service] OrderCompleted received for ${payload.orderId}`);
            }

            if (payload.type === 'OrderCancelled') {
              const ord = orders.get(payload.orderId);
              if (ord) {
                ord.status = 'cancelled';
                ord.reason = payload.reason || 'payment_failed';
                ord.updatedAt = new Date().toISOString();
              }
              console.log(`[Order Service] OrderCancelled received for ${payload.orderId}`);
            }
          } catch (err) {
            console.error('[Order Service] Failed to process message', err);
          }
        },
      });

      console.log('[Order Service] Kafka connected');
      return;
    } catch (err) {
      attempts += 1;
      console.log(`[Order Service] Kafka connect attempt ${attempts} failed:`, err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Could not connect to Kafka');
}

async function publish(topic, message) {
  await producer.send({ topic, messages: [{ value: JSON.stringify(message) }] });
}

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service' });
});

app.post('/orders', async (req, res) => {
  const { amount } = req.body || {};
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const orderId = uuidv4();
  const order = {
    orderId,
    amount,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  orders.set(orderId, order);

  // Emit OrderCreated event to start the saga
  const event = { type: 'OrderCreated', orderId, amount, ts: Date.now() };
  try {
    await publish(ORDER_EVENTS, event);
    console.log(`[Order Service] Published OrderCreated for ${orderId}`);
    res.status(202).json({ orderId, status: order.status });
  } catch (err) {
    console.error('[Order Service] Failed to publish OrderCreated', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'not_found' });
  res.json(order);
});

(async () => {
  try {
    await startKafka();
    app.listen(PORT, () => console.log(`[Order Service] Listening on http://0.0.0.0:${PORT}`));
  } catch (err) {
    console.error('[Order Service] Fatal error starting service', err);
    process.exit(1);
  }
})();
