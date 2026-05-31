import http from 'node:http'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAiReviewerConfig } from './config/aiReviewerConfig.js'
import { getRuntimeConfigPath, getRuntimeEnvSync, readRuntimeConfig, saveRuntimeConfig } from './config/runtimeConfigStore.js'
import { readFeedbackEvents, saveFeedbackEvent, summarizeFeedback } from './feedback/feedbackStore.js'
import { buildContextFilesForAnalysis, fetchGitHubPullRequestContext } from './github/contextClient.js'
import { createExamplePullRequestPayload, createPullRequestJob } from './github/reviewPipeline.js'
import { createGitHubSignature, verifyGitHubSignature } from './github/verifySignature.js'
import { buildModelRoutePlan } from './models/modelRouter.js'
import { retrieveReviewContext } from './rag/contextRetriever.js'
import { runRuleEngine } from './rules/ruleEngine.js'

const port = Number(process.env.PORT ?? 8787)
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? ''
const configPath = process.env.AI_REVIEWER_CONFIG_PATH ?? path.resolve(process.cwd(), '.ai-reviewer.yml')
const feedbackStorePath = process.env.FEEDBACK_STORE_PATH ?? path.resolve(process.cwd(), 'data/feedback.jsonl')

function jsonResponse(response, statusCode, body) {
  const payload = JSON.stringify(body, null, 2)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-github-event,x-hub-signature-256',
  })
  response.end(payload)
}

function emptyResponse(response, statusCode = 204) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-github-event,x-hub-signature-256',
  })
  response.end()
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

async function handleGitHubWebhook(request, response) {
  const body = await readRequestBody(request)
  const eventName = request.headers['x-github-event'] ?? 'unknown'
  const signature = request.headers['x-hub-signature-256']
  const signatureResult = verifyGitHubSignature({ secret: webhookSecret, body, signature })

  if (!signatureResult.ok) {
    jsonResponse(response, 401, {
      ok: false,
      error: 'GitHub webhook signature verification failed',
      detail: signatureResult.reason,
    })
    return
  }

  let payload

  try {
    payload = JSON.parse(body.toString('utf8') || '{}')
  } catch {
    jsonResponse(response, 400, { ok: false, error: 'Invalid JSON payload' })
    return
  }

  const loadedConfig = await loadAiReviewerConfig(configPath)
  const job = createPullRequestJob(payload, eventName, { reviewConfig: loadedConfig.config })
  const githubContext = await loadGitHubContextForPayload(payload, loadedConfig.config)
  const analysisFiles = buildAnalysisFiles(payload, githubContext)
  const ruleAnalysis = runRuleEngine({
    job,
    reviewConfig: loadedConfig.config,
    files: analysisFiles,
  })
  const modelRoutePlan = buildModelRoutePlan({ reviewConfig: loadedConfig.config, ruleAnalysis })
  const ragContext = retrieveReviewContext({
    query: [job.pullRequest.title, job.pullRequest.head, ruleAnalysis.findings.map((finding) => finding.rule).join(' ')].join(' '),
    reviewConfig: loadedConfig.config,
    files: analysisFiles,
  })

  jsonResponse(response, job.status === 'queued' ? 202 : 200, {
    ok: true,
    signature: signatureResult,
    config: {
      path: loadedConfig.path,
      project: loadedConfig.config.project,
      review: loadedConfig.config.review,
    },
    job,
    githubContext,
    ruleAnalysis,
    modelRoutePlan,
    ragContext,
  })
}

async function handleRuleAnalysis(request, response) {
  const body = await readRequestBody(request)
  const loadedConfig = await loadAiReviewerConfig(configPath)
  let input

  try {
    input = JSON.parse(body.toString('utf8') || '{}')
  } catch {
    jsonResponse(response, 400, { ok: false, error: 'Invalid JSON payload' })
    return
  }

  const payload = input.payload ?? createExamplePullRequestPayload()
  const eventName = input.eventName ?? 'pull_request'
  const githubContext = input.githubContext ?? (input.fetchGitHubContext ? await loadGitHubContextForPayload(payload, loadedConfig.config) : null)
  const files = Array.isArray(input.files) ? input.files : buildAnalysisFiles(payload, githubContext)
  const job = input.job ?? createPullRequestJob(payload, eventName, { reviewConfig: loadedConfig.config })
  const ruleAnalysis = runRuleEngine({ job, reviewConfig: loadedConfig.config, files })
  const modelRoutePlan = buildModelRoutePlan({ reviewConfig: loadedConfig.config, ruleAnalysis })
  const ragContext = retrieveReviewContext({
    query: input.query ?? [job.pullRequest.title, ruleAnalysis.findings.map((finding) => finding.rule).join(' ')].join(' '),
    reviewConfig: loadedConfig.config,
    files,
  })

  jsonResponse(response, 200, {
    ok: true,
    config: {
      path: loadedConfig.path,
      review: loadedConfig.config.review,
      guardrails: loadedConfig.config.guardrails,
    },
    job,
    githubContext,
    ruleAnalysis,
    modelRoutePlan,
    ragContext,
  })
}

async function loadGitHubContextForPayload(payload, reviewConfig) {
  try {
    return await fetchGitHubPullRequestContext({ payload, reviewConfig, token: getRuntimeEnvSync().GITHUB_TOKEN })
  } catch (error) {
    return {
      source: 'github-api-unavailable',
      error: error instanceof Error ? error.message : String(error),
      changedFiles: payload.files ?? [],
      fullFiles: [],
      dependencyFiles: [],
      issues: [],
      jira: {
        enabled: Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_API_TOKEN),
        items: [],
        reason: 'Jira context is not connected in this local context step.',
      },
      historicalSnippets: [],
    }
  }
}

async function handleRuntimeConfig(response) {
  jsonResponse(response, 200, {
    ok: true,
    config: await readRuntimeConfig(),
  })
}

async function handleRuntimeConfigSave(request, response) {
  const body = await readRequestBody(request)
  let input

  try {
    input = JSON.parse(body.toString('utf8') || '{}')
  } catch {
    jsonResponse(response, 400, { ok: false, error: 'Invalid JSON payload' })
    return
  }

  const config = await saveRuntimeConfig(input)

  jsonResponse(response, 200, { ok: true, config })
}

function buildAnalysisFiles(payload, githubContext) {
  const contextFiles = buildContextFilesForAnalysis(githubContext)

  if (contextFiles.length) {
    return contextFiles
  }

  return payload.files ?? []
}

async function handleFeedback(request, response) {
  const body = await readRequestBody(request)
  let input

  try {
    input = JSON.parse(body.toString('utf8') || '{}')
  } catch {
    jsonResponse(response, 400, { ok: false, error: 'Invalid JSON payload' })
    return
  }

  try {
    const event = await saveFeedbackEvent(input, feedbackStorePath)
    jsonResponse(response, 201, { ok: true, event })
  } catch (error) {
    jsonResponse(response, 400, {
      ok: false,
      error: 'Invalid feedback event',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleFeedbackSummary(response) {
  const events = await readFeedbackEvents(feedbackStorePath)

  jsonResponse(response, 200, {
    ok: true,
    storePath: feedbackStorePath,
    summary: summarizeFeedback(events),
  })
}

async function handleExample(response) {
  const payload = createExamplePullRequestPayload()
  const body = Buffer.from(JSON.stringify(payload))
  const loadedConfig = await loadAiReviewerConfig(configPath)
  const acceptedJob = createPullRequestJob(payload, 'pull_request', { reviewConfig: loadedConfig.config })
  const ruleAnalysis = runRuleEngine({ job: acceptedJob, reviewConfig: loadedConfig.config })
  const ragContext = retrieveReviewContext({
    query: acceptedJob.pullRequest.title,
    reviewConfig: loadedConfig.config,
  })

  jsonResponse(response, 200, {
    headers: {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': webhookSecret ? createGitHubSignature(webhookSecret, body) : 'set GITHUB_WEBHOOK_SECRET to generate a real signature',
    },
    payload,
    acceptedJob,
    ruleAnalysis,
    modelRoutePlan: buildModelRoutePlan({ reviewConfig: loadedConfig.config, ruleAnalysis }),
    ragContext,
  })
}

export function createGitHubAppServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

      if (request.method === 'OPTIONS') {
        emptyResponse(response)
        return
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        const runtimeEnv = getRuntimeEnvSync()
        jsonResponse(response, 200, {
          ok: true,
          service: 'codesentinel-github-app',
          webhookSecretConfigured: Boolean(webhookSecret),
          githubTokenConfigured: Boolean(runtimeEnv.GITHUB_TOKEN),
          configPath,
          feedbackStorePath,
          runtimeConfigPath: getRuntimeConfigPath(),
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/runtime-config') {
        await handleRuntimeConfig(response)
        return
      }

      if (request.method === 'POST' && url.pathname === '/runtime-config') {
        await handleRuntimeConfigSave(request, response)
        return
      }

      if (request.method === 'GET' && url.pathname === '/webhooks/github/example') {
        await handleExample(response)
        return
      }

      if (request.method === 'POST' && url.pathname === '/webhooks/github') {
        await handleGitHubWebhook(request, response)
        return
      }

      if (request.method === 'POST' && url.pathname === '/analysis/rules') {
        await handleRuleAnalysis(request, response)
        return
      }

      if (request.method === 'POST' && url.pathname === '/feedback') {
        await handleFeedback(request, response)
        return
      }

      if (request.method === 'GET' && url.pathname === '/feedback/summary') {
        await handleFeedbackSummary(response)
        return
      }

      jsonResponse(response, 404, {
        ok: false,
        error: 'Route not found',
        routes: ['GET /health', 'GET /runtime-config', 'POST /runtime-config', 'GET /webhooks/github/example', 'POST /webhooks/github', 'POST /analysis/rules', 'POST /feedback', 'GET /feedback/summary'],
      })
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: 'Unhandled server error',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

async function runCheck() {
  const secret = 'local-check-secret'
  const body = Buffer.from(JSON.stringify(createExamplePullRequestPayload()))
  const validSignature = createGitHubSignature(secret, body)
  const signatureResult = verifyGitHubSignature({ secret, body, signature: validSignature })
  const loadedConfig = await loadAiReviewerConfig(configPath)
  const job = createPullRequestJob(createExamplePullRequestPayload(), 'pull_request', { reviewConfig: loadedConfig.config })
  const githubContext = {
    source: 'self-check',
    changedFiles: [{ filename: 'server/github/reviewPipeline.js', patch: '+ validate tenant auth before merge' }],
    fullFiles: [],
    dependencyFiles: [],
    issues: [],
    historicalSnippets: [{ path: 'server/github/reviewPipeline.js', content: 'validate tenant auth before merge' }],
  }
  const analysisFiles = buildAnalysisFiles(createExamplePullRequestPayload(), githubContext)
  const ruleAnalysis = runRuleEngine({
    job,
    reviewConfig: loadedConfig.config,
    files: analysisFiles,
  })
  const modelRoutePlan = buildModelRoutePlan({ reviewConfig: loadedConfig.config, ruleAnalysis })
  const ragContext = retrieveReviewContext({
    query: 'tenant auth merge server',
    reviewConfig: loadedConfig.config,
    files: analysisFiles,
  })
  const feedbackCheckPath = path.join(os.tmpdir(), `codesentinel-feedback-check-${Date.now()}.jsonl`)
  const feedbackEvent = await saveFeedbackEvent(
    {
      action: 'helpful',
      repository: job.repository.fullName,
      pullRequest: job.pullRequest.number,
      findingId: ruleAnalysis.findings[0]?.id,
      severity: ruleAnalysis.findings[0]?.severity,
      rule: ruleAnalysis.findings[0]?.rule,
      actor: 'self-check',
    },
    feedbackCheckPath,
  )
  await rm(feedbackCheckPath, { force: true })

  if (
    !signatureResult.ok ||
    job.status !== 'queued' ||
    job.pipeline.length !== 3 ||
    !job.reviewConfig ||
    !analysisFiles.length ||
    !ruleAnalysis.findings.length ||
    modelRoutePlan.routes.length !== 4 ||
    !ragContext.hits.length ||
    !feedbackEvent.id
  ) {
    throw new Error('GitHub App server self-check failed')
  }

  console.log(JSON.stringify({ ok: true, checked: ['signature', 'pull_request_job', 'pipeline', 'ai_reviewer_config', 'rule_engine', 'model_router', 'rag_context', 'feedback_store'] }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else if (isDirectRun) {
  createGitHubAppServer().listen(port, () => {
    console.log(`CodeSentinel GitHub App server listening on http://127.0.0.1:${port}`)
  })
}
