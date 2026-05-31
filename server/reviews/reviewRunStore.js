import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function countRisks(risks = []) {
  return risks.reduce(
    (counts, risk) => {
      counts.total += 1
      counts.bySeverity[risk.severity] = (counts.bySeverity[risk.severity] ?? 0) + 1
      return counts
    },
    { total: 0, bySeverity: {} },
  )
}

function normalizeReviewRun(input = {}) {
  const job = input.job ?? {}
  const ruleAnalysis = input.ruleAnalysis ?? {}
  const aiReview = input.aiReview ?? {}
  const githubContext = input.githubContext ?? {}
  const ragContext = input.ragContext ?? {}
  const publishResult = input.publishResult ?? null
  const risks = aiReview.review?.risks?.length ? aiReview.review.risks : ruleAnalysis.findings ?? []

  return {
    id: input.id ? String(input.id) : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    source: input.source ? String(input.source) : 'review',
    repository: job.repository?.fullName ?? '',
    pullRequest: job.pullRequest?.number ?? null,
    title: job.pullRequest?.title ?? '',
    headSha: job.pullRequest?.headSha ?? '',
    status: aiReview.status ?? job.status ?? 'unknown',
    healthScore: ruleAnalysis.healthScore ?? null,
    mergeGate: ruleAnalysis.mergeGate ?? null,
    risks: countRisks(risks),
    context: {
      changedFiles: githubContext.changedFiles?.length ?? 0,
      fullFiles: githubContext.fullFiles?.length ?? 0,
      dependencyFiles: githubContext.dependencyFiles?.length ?? 0,
      issues: githubContext.issues?.length ?? 0,
      historicalSnippets: githubContext.historicalSnippets?.length ?? 0,
      ragHits: ragContext.hits?.length ?? 0,
    },
    model: aiReview.route
      ? {
          provider: aiReview.route.provider,
          model: aiReview.route.model,
        }
      : null,
    publish: publishResult
      ? {
          status: publishResult.status,
          tokenSource: publishResult.tokenSource,
          checkRunConclusion: publishResult.checkRun?.conclusion ?? null,
          inlineComments: publishResult.inlineComments?.length ?? 0,
        }
      : null,
  }
}

export async function saveReviewRun(input, storePath) {
  const run = normalizeReviewRun(input)
  const resolvedPath = path.resolve(storePath)

  await mkdir(path.dirname(resolvedPath), { recursive: true })
  await appendFile(resolvedPath, `${JSON.stringify(run)}\n`, 'utf8')

  return run
}

export async function readReviewRuns(storePath) {
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

export function summarizeReviewRuns(runs) {
  return runs.reduce(
    (summary, run) => {
      summary.total += 1
      summary.byRepository[run.repository] = (summary.byRepository[run.repository] ?? 0) + 1
      summary.byStatus[run.status] = (summary.byStatus[run.status] ?? 0) + 1

      for (const [severity, count] of Object.entries(run.risks.bySeverity ?? {})) {
        summary.risksBySeverity[severity] = (summary.risksBySeverity[severity] ?? 0) + count
      }

      if (run.publish?.status) {
        summary.byPublishStatus[run.publish.status] = (summary.byPublishStatus[run.publish.status] ?? 0) + 1
      }

      return summary
    },
    { total: 0, byRepository: {}, byStatus: {}, byPublishStatus: {}, risksBySeverity: {} },
  )
}

async function runCheck() {
  const storePath = path.join(os.tmpdir(), `codesentinel-review-runs-${Date.now()}.jsonl`)

  await saveReviewRun(
    {
      source: 'self-check',
      job: {
        repository: { fullName: 'acme/codesentinel' },
        pullRequest: { number: 42, title: 'Protect merge', headSha: 'abc123' },
      },
      ruleAnalysis: {
        healthScore: 82,
        mergeGate: { state: 'failure' },
        findings: [{ severity: 'P0', title: 'Auth bypass' }],
      },
      ragContext: { hits: [{ id: 'standard' }] },
      githubContext: { changedFiles: [{ filename: 'src/auth.js' }] },
      aiReview: { status: 'fallback', review: { risks: [], checklist: [] } },
      publishResult: { status: 'published', tokenSource: 'github-app-installation', checkRun: { conclusion: 'failure' }, inlineComments: [{}] },
    },
    storePath,
  )

  const runs = await readReviewRuns(storePath)
  const summary = summarizeReviewRuns(runs)
  await rm(storePath, { force: true })

  if (runs.length !== 1 || summary.risksBySeverity.P0 !== 1 || summary.byPublishStatus.published !== 1) {
    throw new Error('Review run store self-check failed')
  }

  console.log(JSON.stringify({ ok: true, runs: runs.length, summary }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
