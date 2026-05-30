import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAiReviewerConfig } from '../config/aiReviewerConfig.js'
import { resolveModelRuntime } from './modelRuntime.js'

const taskDefaults = {
  summary: {
    priority: 'speed',
    fallback: 'local-summary-rules',
  },
  intent: {
    priority: 'balanced',
    fallback: 'local-intent-heuristics',
  },
  risk: {
    priority: 'accuracy',
    fallback: 'rule-engine-only',
  },
  architecture: {
    priority: 'accuracy',
    fallback: 'rag-pattern-check',
  },
}

function hasBlocker(ruleAnalysis) {
  return Boolean(ruleAnalysis?.blockers?.length)
}

function getRouteConfig(reviewConfig, taskName) {
  if (taskName === 'intent') {
    return reviewConfig.models.summary
  }

  return reviewConfig.models[taskName] ?? reviewConfig.models.risk
}

export function buildModelRoutePlan({ reviewConfig, ruleAnalysis }) {
  const tasks = ['summary', 'intent', 'risk', 'architecture']
  const containsBlocker = hasBlocker(ruleAnalysis)

  return {
    mode: containsBlocker ? 'deep-review' : 'fast-review',
    reason: containsBlocker ? 'P0 Blocker 命中，风险与架构任务升级为强推理路径。' : '未命中 P0，优先控制响应速度和成本。',
    routes: tasks.map((taskName) => {
      const modelConfig = getRouteConfig(reviewConfig, taskName)
      const runtime = resolveModelRuntime({ ...modelConfig, task: taskName })
      const defaultConfig = taskDefaults[taskName]
      const shouldEscalate = containsBlocker && ['risk', 'architecture'].includes(taskName)

      return {
        task: taskName,
        provider: runtime.provider,
        model: runtime.model,
        baseUrl: runtime.baseUrl,
        apiKeyEnv: runtime.apiKeyEnv,
        credentialConfigured: runtime.credentialConfigured,
        maxLatencyMs: modelConfig.maxLatencyMs,
        priority: shouldEscalate ? 'accuracy' : defaultConfig.priority,
        fallback: defaultConfig.fallback,
        streaming: ['summary', 'intent'].includes(taskName),
        escalation: shouldEscalate,
      }
    }),
    budgetGuard: {
      stopLowValueP2: true,
      maxTotalLatencyMs: reviewConfig.review.targetLatencySeconds * 1000,
      confidenceThreshold: reviewConfig.review.confidenceThreshold,
    },
  }
}

async function runCheck() {
  const { config } = await loadAiReviewerConfig()
  const plan = buildModelRoutePlan({
    reviewConfig: config,
    ruleAnalysis: { blockers: [{ severity: 'P0' }] },
  })

  if (plan.mode !== 'deep-review' || !plan.routes.some((route) => route.escalation)) {
    throw new Error('Model router self-check failed')
  }

  console.log(JSON.stringify({ ok: true, mode: plan.mode, routes: plan.routes.length }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
