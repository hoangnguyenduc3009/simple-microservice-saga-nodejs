const express = require('express');
const morgan = require('morgan');
const { Kafka } = require('kafkajs');

const PORT = process.env.PORT || 4002;
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

const kafka = new Kafka({ clientId: 'saga-coordinator', brokers: [KAFKA_BROKER] });
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'saga-coordinator-group' });

const ORDER_EVENTS = 'order-events';
const PAYMENT_EVENTS = 'payment-events';
const PAYMENT_COMMANDS = 'payment-commands';

async function startKafka() {
  let attempts = 0;
  while (attempts < 20) {
    try {
      await producer.connect();
      await consumer.connect();
      await consumer.subscribe({ topic: ORDER_EVENTS, fromBeginning: false });
      await consumer.subscribe({ topic: PAYMENT_EVENTS, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            const payload = JSON.parse(message.value.toString());
            if (!payload || !payload.type) return;

            if (topic === ORDER_EVENTS && payload.type === 'OrderCreated') {
              console.log(`[Saga] Start saga for order ${payload.orderId}, amount ${payload.amount}`);
              await producer.send({
                topic: PAYMENT_COMMANDS,
                messages: [
                  { value: JSON.stringify({ type: 'ProcessPayment', orderId: payload.orderId, amount: payload.amount, ts: Date.now() }) },
                ],
              });
              console.log(`[Saga] Sent ProcessPayment for order ${payload.orderId}`);
            }

            if (topic === PAYMENT_EVENTS && payload.type === 'PaymentSucceeded') {
              console.log(`[Saga] PaymentSucceeded for ${payload.orderId}, completing order`);
              await producer.send({
                topic: ORDER_EVENTS,
                messages: [ { value: JSON.stringify({ type: 'OrderCompleted', orderId: payload.orderId, ts: Date.now() }) } ],
              });
            }

            if (topic === PAYMENT_EVENTS && payload.type === 'PaymentFailed') {
              console.log(`[Saga] PaymentFailed for ${payload.orderId}, cancelling order`);
              await producer.send({
                topic: ORDER_EVENTS,
                messages: [ { value: JSON.stringify({ type: 'OrderCancelled', orderId: payload.orderId, reason: payload.reason || 'payment_failed', ts: Date.now() }) } ],
              });
            }
          } catch (err) {
            console.error('[Saga] Error handling message', err);
          }
        },
      });

      console.log('[Saga] Kafka connected');
      return;
    } catch (err) {
      attempts += 1;
      console.log(`[Saga] Kafka connect attempt ${attempts} failed:`, err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Saga could not connect to Kafka');
}

const app = express();
app.use(morgan('dev'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'saga-coordinator' }));

(async () => {
  try {
    await startKafka();
    app.listen(PORT, () => console.log(`[Saga] Listening on http://0.0.0.0:${PORT}`));
  } catch (err) {
    console.error('[Saga] Fatal error starting', err);
    process.exit(1);
  }
})();
