import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const terminalStates = new Set(['completed', 'failed'])

function createQueueJob({ type, payload }) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    state: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    attempts: 0,
    payload,
    result: null,
    error: null,
  }
}

export function createReviewJobQueue({ maxAttempts = 1 } = {}) {
  const jobs = new Map()
  const dedupeIndex = new Map()

  async function runJob(job, worker) {
    job.state = 'running'
    job.startedAt = job.startedAt ?? new Date().toISOString()
    job.updatedAt = new Date().toISOString()
    job.attempts += 1

    try {
      job.result = await worker(job.payload, job)
      job.state = 'completed'
      job.completedAt = new Date().toISOString()
      job.updatedAt = job.completedAt
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error)
      job.updatedAt = new Date().toISOString()

      if (job.attempts < maxAttempts) {
        job.state = 'queued'
        queueMicrotask(() => runJob(job, worker))
        return
      }

      job.state = 'failed'
      job.completedAt = new Date().toISOString()
      job.updatedAt = job.completedAt
    }
  }

  return {
    enqueue({ type, payload, worker, dedupeKey }) {
      if (dedupeKey && dedupeIndex.has(dedupeKey)) {
        const existing = jobs.get(dedupeIndex.get(dedupeKey))

        if (existing && !terminalStates.has(existing.state)) {
          return { ...existing, deduped: true }
        }
      }

      const job = createQueueJob({ type, payload })
      job.dedupeKey = dedupeKey || null
      jobs.set(job.id, job)
      if (dedupeKey) {
        dedupeIndex.set(dedupeKey, job.id)
      }
      queueMicrotask(() => runJob(job, worker))
      return job
    },
    get(id) {
      return jobs.get(id) ?? null
    },
    list({ limit = 50 } = {}) {
      return [...jobs.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
    },
    summary() {
      return [...jobs.values()].reduce(
        (summary, job) => {
          summary.total += 1
          summary.byState[job.state] = (summary.byState[job.state] ?? 0) + 1
          summary.active += terminalStates.has(job.state) ? 0 : 1
          return summary
        },
        { total: 0, active: 0, byState: {} },
      )
    },
  }
}

async function runCheck() {
  const queue = createReviewJobQueue()
  const job = queue.enqueue({
    type: 'self-check',
    dedupeKey: 'self-check:1',
    payload: { value: 41 },
    worker: async (payload) => ({ value: payload.value + 1 }),
  })
  const duplicate = queue.enqueue({
    type: 'self-check',
    dedupeKey: 'self-check:1',
    payload: { value: 0 },
    worker: async (payload) => ({ value: payload.value }),
  })

  for (let index = 0; index < 10 && queue.get(job.id)?.state !== 'completed'; index += 1) {
    await delay(1)
  }

  const stored = queue.get(job.id)
  const summary = queue.summary()

  if (stored?.state !== 'completed' || duplicate.id !== job.id || stored.result.value !== 42 || summary.byState.completed !== 1) {
    throw new Error('Review job queue self-check failed')
  }

  console.log(JSON.stringify({ ok: true, job: stored.id, state: stored.state, summary }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
