/**
 * Job queue abstraction — BullMQ over Redis if REDIS_URL is set,
 * otherwise in-process async queue for dev without Redis.
 */

let Queue = null, Worker = null, IORedis = null;
try { ({ Queue, Worker } = require('bullmq')); } catch (e) { /* not installed */ }
try { IORedis = require('ioredis'); } catch (e) { /* not installed */ }

const REDIS_URL = process.env.REDIS_URL;
const QUEUE_MODE = REDIS_URL && Queue && IORedis ? 'bullmq' : 'inproc';

console.log(`[queue] Mode: ${QUEUE_MODE}`);

// ── BullMQ path ──────────────────────────────────────────────
let redisConn = null;
function getRedis() {
  if (!redisConn) {
    redisConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return redisConn;
}

const queues = {};
function getQueue(name) {
  if (QUEUE_MODE !== 'bullmq') return null;
  if (!queues[name]) {
    queues[name] = new Queue(name, { connection: getRedis() });
  }
  return queues[name];
}

// ── In-process path (dev only) ───────────────────────────────
const inproc = {
  handlers: {}, // queueName -> handler fn
  counts: {},   // queueName -> active count
};

async function addJob(queueName, data, opts = {}) {
  if (QUEUE_MODE === 'bullmq') {
    const q = getQueue(queueName);
    const job = await q.add(queueName, data, opts);
    return { id: job.id, queue: 'bullmq' };
  }
  // In-proc: fire-and-forget
  const handler = inproc.handlers[queueName];
  if (!handler) {
    console.warn(`[queue] No handler registered for '${queueName}', job dropped`);
    return { id: null, queue: 'inproc-nohandler' };
  }
  inproc.counts[queueName] = (inproc.counts[queueName] || 0) + 1;
  setImmediate(async () => {
    try {
      await handler({ id: `inproc-${Date.now()}`, data, name: queueName });
    } catch (err) {
      console.error(`[queue:${queueName}] job error`, err);
    } finally {
      inproc.counts[queueName]--;
    }
  });
  return { id: `inproc-${Date.now()}`, queue: 'inproc' };
}

function registerWorker(queueName, handlerFn, opts = {}) {
  if (QUEUE_MODE === 'bullmq') {
    const worker = new Worker(queueName, handlerFn, {
      connection: getRedis(),
      concurrency: opts.concurrency || 4,
    });
    worker.on('failed', (job, err) => console.error(`[worker:${queueName}] failed`, job?.id, err.message));
    worker.on('completed', (job) => console.log(`[worker:${queueName}] done`, job.id));
    console.log(`[queue] BullMQ worker registered for '${queueName}' concurrency=${opts.concurrency || 4}`);
    return worker;
  }
  inproc.handlers[queueName] = handlerFn;
  console.log(`[queue] In-process handler registered for '${queueName}'`);
  return null;
}

async function getQueueStatus(queueName) {
  if (QUEUE_MODE === 'bullmq') {
    const q = getQueue(queueName);
    const [active, waiting, completed, failed] = await Promise.all([
      q.getActiveCount(), q.getWaitingCount(), q.getCompletedCount(), q.getFailedCount(),
    ]);
    return { mode: 'bullmq', active, waiting, completed, failed };
  }
  return { mode: 'inproc', active: inproc.counts[queueName] || 0 };
}

module.exports = { addJob, registerWorker, getQueueStatus, QUEUE_MODE };
