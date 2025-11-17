const express = require('express');
const morgan = require('morgan');
const { Kafka } = require('kafkajs');

const PORT = process.env.PORT || 4001;
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const SUCCESS_RATE = parseFloat(process.env.SUCCESS_RATE || '0.7'); // 70% success default

const kafka = new Kafka({ clientId: 'payment-service', brokers: [KAFKA_BROKER] });
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'payment-service-group' });

const PAYMENT_EVENTS = 'payment-events';
const PAYMENT_COMMANDS = 'payment-commands';

async function startKafka() {
  let attempts = 0;
  while (attempts < 20) {
    try {
      await producer.connect();
      await consumer.connect();
      await consumer.subscribe({ topic: PAYMENT_COMMANDS, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            const payload = JSON.parse(message.value.toString());
            if (!payload || payload.type !== 'ProcessPayment') return;
            const { orderId, amount } = payload;
            console.log(`[Payment] Processing payment for order ${orderId}, amount ${amount}`);

            // Simulate processing time
            await new Promise(r => setTimeout(r, 300));

            const succeeded = Math.random() < SUCCESS_RATE;
            const event = succeeded
              ? { type: 'PaymentSucceeded', orderId, amount, ts: Date.now() }
              : { type: 'PaymentFailed', orderId, amount, reason: 'card_declined', ts: Date.now() };

            await producer.send({ topic: PAYMENT_EVENTS, messages: [{ value: JSON.stringify(event) }] });
            console.log(`[Payment] Published ${event.type} for ${orderId}`);
          } catch (err) {
            console.error('[Payment] Error handling payment command', err);
          }
        },
      });

      console.log('[Payment] Kafka connected');
      return;
    } catch (err) {
      attempts += 1;
      console.log(`[Payment] Kafka connect attempt ${attempts} failed:`, err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Payment Service could not connect to Kafka');
}

const app = express();
app.use(morgan('dev'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'payment-service', successRate: SUCCESS_RATE }));

(async () => {
  try {
    await startKafka();
    app.listen(PORT, () => console.log(`[Payment] Listening on http://0.0.0.0:${PORT}`));
  } catch (err) {
    console.error('[Payment] Fatal error starting', err);
    process.exit(1);
  }
})();
