import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAiReviewerConfig } from '../config/aiReviewerConfig.js'
import { getRuntimeEnvSync } from '../config/runtimeConfigStore.js'
import { readImplicitStandardIndexSync } from './implicitStandardIndex.js'

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
    .filter((token) => token.length > 1)
}

function scoreText(queryTokens, text) {
  const textTokens = new Set(tokenize(text))
  return queryTokens.reduce((score, token) => score + (textTokens.has(token) ? 1 : 0), 0)
}

function buildConfigSlices(reviewConfig) {
  return [
    {
      id: 'implicit-standard:blockers',
      source: 'implicit-code-standard',
      title: 'Blocker rules from .ai-reviewer.yml',
      content: reviewConfig.guardrails.blockerRules.join(' '),
    },
    {
      id: 'implicit-standard:critical-paths',
      source: 'implicit-code-standard',
      title: 'Critical paths from .ai-reviewer.yml',
      content: reviewConfig.guardrails.criticalPaths.join(' '),
    },
    {
      id: 'implicit-standard:test-policy',
      source: 'implicit-code-standard',
      title: 'Required test domains from .ai-reviewer.yml',
      content: reviewConfig.guardrails.requireTestsFor.join(' '),
    },
  ]
}

function buildFileSlices(files) {
  return files.map((file, index) => ({
    id: `changed-file:${index}:${file.filename ?? 'unknown'}`,
    source: 'changed-file-patch',
    title: file.filename ?? 'Changed file',
    content: [file.filename, file.status, file.patch].filter(Boolean).join('\n'),
  }))
}

function buildIndexedSlices(env) {
  try {
    return readImplicitStandardIndexSync({ indexPath: env.IMPLICIT_STANDARD_INDEX_PATH })
      .map((slice) => ({
        id: slice.id,
        source: slice.source,
        title: slice.title,
        content: [slice.repository, slice.path, slice.content].filter(Boolean).join('\n'),
      }))
  } catch {
    return []
  }
}

export function retrieveReviewContext({ query, reviewConfig, files = [] }) {
  const enabled = reviewConfig.context.rag.enabled
  const topK = reviewConfig.context.rag.recallTopK
  const queryTokens = tokenize(query)
  const slices = [...buildConfigSlices(reviewConfig), ...buildIndexedSlices(getRuntimeEnvSync()), ...buildFileSlices(files)]

  if (!enabled || !queryTokens.length) {
    return {
      enabled,
      query,
      topK,
      hits: [],
      reason: enabled ? 'empty query' : 'RAG disabled by .ai-reviewer.yml',
    }
  }

  const hits = slices
    .map((slice) => ({
      ...slice,
      score: scoreText(queryTokens, `${slice.title}\n${slice.content}`),
    }))
    .filter((slice) => slice.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK)

  return {
    enabled,
    query,
    topK,
    hits,
    reason: hits.length ? 'context recalled' : 'no matching context',
  }
}

async function runCheck() {
  const { config } = await loadAiReviewerConfig()
  const result = retrieveReviewContext({
    query: 'tenant auth merge server',
    reviewConfig: config,
    files: [{ filename: 'server/github/reviewPipeline.js', patch: '+ validate tenant auth before merge' }],
  })

  if (!result.hits.length) {
    throw new Error('RAG retriever self-check failed')
  }

  console.log(JSON.stringify({ ok: true, hits: result.hits.length, topHit: result.hits[0].id }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
