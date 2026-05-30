import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

export const defaultAiReviewerConfig = Object.freeze({
  version: 1,
  project: {
    name: 'CodeSentinel',
    type: 'unknown',
    language: 'unknown',
  },
  review: {
    minimumSeverity: 'P1',
    confidenceThreshold: 0.8,
    targetLatencySeconds: 30,
    activeLanes: ['guardrail', 'intent', 'architecture'],
  },
  guardrails: {
    blockerRules: [],
    criticalPaths: [],
    requireTestsFor: [],
  },
  context: {
    includeFullFiles: true,
    includeDependencyFiles: true,
    dependencyFiles: ['package.json'],
    rag: {
      enabled: false,
      recallTopK: 5,
      sources: [],
    },
  },
  models: {
    summary: {
      provider: 'local',
      model: 'fast-summary',
      maxLatencyMs: 3000,
    },
    risk: {
      provider: 'local',
      model: 'strong-reasoning',
      maxLatencyMs: 12000,
    },
    architecture: {
      provider: 'local',
      model: 'architecture-reviewer',
      maxLatencyMs: 18000,
    },
  },
  feedback: {
    persistence: 'file',
    allowThumbs: true,
    learnFromIgnoredP2: true,
  },
})

const allowedSeverities = new Set(['P0', 'P1', 'P2'])
const allowedLanes = new Set(['guardrail', 'intent', 'architecture'])

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value, fallback = []) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined).map(String) : fallback
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asNumber(value, fallback, { min, max } = {}) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  if (typeof min === 'number' && parsed < min) {
    return fallback
  }

  if (typeof max === 'number' && parsed > max) {
    return fallback
  }

  return parsed
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeModelConfig(value, fallback) {
  const model = asObject(value)

  return {
    provider: asString(model.provider, fallback.provider),
    model: asString(model.model, fallback.model),
    maxLatencyMs: asNumber(model.maxLatencyMs, fallback.maxLatencyMs, { min: 100 }),
  }
}

export function normalizeAiReviewerConfig(rawConfig = {}) {
  const raw = asObject(rawConfig)
  const project = asObject(raw.project)
  const review = asObject(raw.review)
  const guardrails = asObject(raw.guardrails)
  const context = asObject(raw.context)
  const rag = asObject(context.rag)
  const models = asObject(raw.models)
  const feedback = asObject(raw.feedback)
  const minimumSeverity = asString(review.minimumSeverity, defaultAiReviewerConfig.review.minimumSeverity).toUpperCase()
  const activeLanes = asArray(review.activeLanes, defaultAiReviewerConfig.review.activeLanes).filter((lane) => allowedLanes.has(lane))

  return {
    version: asNumber(raw.version, defaultAiReviewerConfig.version, { min: 1 }),
    project: {
      name: asString(project.name, defaultAiReviewerConfig.project.name),
      type: asString(project.type, defaultAiReviewerConfig.project.type),
      language: asString(project.language, defaultAiReviewerConfig.project.language),
    },
    review: {
      minimumSeverity: allowedSeverities.has(minimumSeverity) ? minimumSeverity : defaultAiReviewerConfig.review.minimumSeverity,
      confidenceThreshold: asNumber(review.confidenceThreshold, defaultAiReviewerConfig.review.confidenceThreshold, { min: 0, max: 1 }),
      targetLatencySeconds: asNumber(review.targetLatencySeconds, defaultAiReviewerConfig.review.targetLatencySeconds, { min: 1 }),
      activeLanes: activeLanes.length ? activeLanes : defaultAiReviewerConfig.review.activeLanes,
    },
    guardrails: {
      blockerRules: asArray(guardrails.blockerRules, defaultAiReviewerConfig.guardrails.blockerRules),
      criticalPaths: asArray(guardrails.criticalPaths, defaultAiReviewerConfig.guardrails.criticalPaths),
      requireTestsFor: asArray(guardrails.requireTestsFor, defaultAiReviewerConfig.guardrails.requireTestsFor),
    },
    context: {
      includeFullFiles: asBoolean(context.includeFullFiles, defaultAiReviewerConfig.context.includeFullFiles),
      includeDependencyFiles: asBoolean(context.includeDependencyFiles, defaultAiReviewerConfig.context.includeDependencyFiles),
      dependencyFiles: asArray(context.dependencyFiles, defaultAiReviewerConfig.context.dependencyFiles),
      rag: {
        enabled: asBoolean(rag.enabled, defaultAiReviewerConfig.context.rag.enabled),
        recallTopK: asNumber(rag.recallTopK, defaultAiReviewerConfig.context.rag.recallTopK, { min: 1, max: 20 }),
        sources: asArray(rag.sources, defaultAiReviewerConfig.context.rag.sources),
      },
    },
    models: {
      summary: normalizeModelConfig(models.summary, defaultAiReviewerConfig.models.summary),
      risk: normalizeModelConfig(models.risk, defaultAiReviewerConfig.models.risk),
      architecture: normalizeModelConfig(models.architecture, defaultAiReviewerConfig.models.architecture),
    },
    feedback: {
      persistence: asString(feedback.persistence, defaultAiReviewerConfig.feedback.persistence),
      allowThumbs: asBoolean(feedback.allowThumbs, defaultAiReviewerConfig.feedback.allowThumbs),
      learnFromIgnoredP2: asBoolean(feedback.learnFromIgnoredP2, defaultAiReviewerConfig.feedback.learnFromIgnoredP2),
    },
  }
}

export function parseAiReviewerConfig(configText) {
  const parsed = YAML.parse(configText) ?? {}
  return normalizeAiReviewerConfig(parsed)
}

export async function loadAiReviewerConfig(configPath = path.resolve(process.cwd(), '.ai-reviewer.yml')) {
  const configText = await readFile(configPath, 'utf8')

  return {
    path: configPath,
    config: parseAiReviewerConfig(configText),
  }
}

async function runCheck() {
  const loaded = await loadAiReviewerConfig()

  if (!loaded.config.guardrails.blockerRules.length) {
    throw new Error('.ai-reviewer.yml must define at least one blocker rule')
  }

  if (!loaded.config.review.activeLanes.includes('guardrail')) {
    throw new Error('.ai-reviewer.yml must keep guardrail lane enabled')
  }

  console.log(JSON.stringify({ ok: true, path: loaded.path, config: loaded.config }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
