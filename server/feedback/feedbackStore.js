import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const allowedActions = new Set(['helpful', 'unhelpful', 'accepted', 'ignored', 'missed-risk'])

function normalizeFeedbackEvent(input = {}) {
  const action = String(input.action ?? '').trim()

  if (!allowedActions.has(action)) {
    throw new Error(`Unsupported feedback action: ${action || 'empty'}`)
  }

  return {
    id: input.id ? String(input.id) : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    action,
    repository: input.repository ? String(input.repository) : '',
    pullRequest: input.pullRequest ? Number(input.pullRequest) : null,
    findingId: input.findingId ? String(input.findingId) : '',
    severity: input.severity ? String(input.severity) : '',
    rule: input.rule ? String(input.rule) : '',
    comment: input.comment ? String(input.comment).slice(0, 1000) : '',
    actor: input.actor ? String(input.actor) : 'anonymous',
  }
}

export async function saveFeedbackEvent(input, storePath) {
  const event = normalizeFeedbackEvent(input)
  const resolvedPath = path.resolve(storePath)

  await mkdir(path.dirname(resolvedPath), { recursive: true })
  await appendFile(resolvedPath, `${JSON.stringify(event)}\n`, 'utf8')

  return event
}

export async function readFeedbackEvents(storePath) {
  const resolvedPath = path.resolve(storePath)

  try {
    const content = await readFile(resolvedPath, 'utf8')
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

export function summarizeFeedback(events) {
  return events.reduce(
    (summary, event) => {
      summary.total += 1
      summary.byAction[event.action] = (summary.byAction[event.action] ?? 0) + 1

      if (event.rule) {
        summary.byRule[event.rule] = (summary.byRule[event.rule] ?? 0) + 1
      }

      if (event.severity) {
        summary.bySeverity[event.severity] = (summary.bySeverity[event.severity] ?? 0) + 1
      }

      return summary
    },
    { total: 0, byAction: {}, byRule: {}, bySeverity: {} },
  )
}

async function runCheck() {
  const storePath = path.join(os.tmpdir(), `codesentinel-feedback-${Date.now()}.jsonl`)

  await saveFeedbackEvent(
    {
      action: 'unhelpful',
      repository: 'acme/codesentinel',
      pullRequest: 42,
      findingId: 'auth-bypass-92',
      severity: 'P0',
      rule: 'auth-bypass',
      comment: 'The suggestion missed a branch protection exception.',
      actor: 'reviewer-a',
    },
    storePath,
  )

  const events = await readFeedbackEvents(storePath)
  const summary = summarizeFeedback(events)
  await rm(storePath, { force: true })

  if (events.length !== 1 || summary.byAction.unhelpful !== 1) {
    throw new Error('Feedback store self-check failed')
  }

  console.log(JSON.stringify({ ok: true, events: events.length, summary }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
