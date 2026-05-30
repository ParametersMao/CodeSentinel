import http from 'node:http'
import path from 'node:path'
import { loadAiReviewerConfig } from './config/aiReviewerConfig.js'
import { createExamplePullRequestPayload, createPullRequestJob } from './github/reviewPipeline.js'
import { createGitHubSignature, verifyGitHubSignature } from './github/verifySignature.js'

const port = Number(process.env.PORT ?? 8787)
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? ''
const configPath = process.env.AI_REVIEWER_CONFIG_PATH ?? path.resolve(process.cwd(), '.ai-reviewer.yml')

function jsonResponse(response, statusCode, body) {
  const payload = JSON.stringify(body, null, 2)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
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

  jsonResponse(response, job.status === 'queued' ? 202 : 200, {
    ok: true,
    signature: signatureResult,
    config: {
      path: loadedConfig.path,
      project: loadedConfig.config.project,
      review: loadedConfig.config.review,
    },
    job,
  })
}

async function handleExample(response) {
  const payload = createExamplePullRequestPayload()
  const body = Buffer.from(JSON.stringify(payload))
  const loadedConfig = await loadAiReviewerConfig(configPath)

  jsonResponse(response, 200, {
    headers: {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': webhookSecret ? createGitHubSignature(webhookSecret, body) : 'set GITHUB_WEBHOOK_SECRET to generate a real signature',
    },
    payload,
    acceptedJob: createPullRequestJob(payload, 'pull_request', { reviewConfig: loadedConfig.config }),
  })
}

export function createGitHubAppServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

      if (request.method === 'GET' && url.pathname === '/health') {
        jsonResponse(response, 200, {
          ok: true,
          service: 'codesentinel-github-app',
          webhookSecretConfigured: Boolean(webhookSecret),
          configPath,
        })
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

      jsonResponse(response, 404, {
        ok: false,
        error: 'Route not found',
        routes: ['GET /health', 'GET /webhooks/github/example', 'POST /webhooks/github'],
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

  if (!signatureResult.ok || job.status !== 'queued' || job.pipeline.length !== 3 || !job.reviewConfig) {
    throw new Error('GitHub App server self-check failed')
  }

  console.log(JSON.stringify({ ok: true, checked: ['signature', 'pull_request_job', 'pipeline', 'ai_reviewer_config'] }, null, 2))
}

if (process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  createGitHubAppServer().listen(port, () => {
    console.log(`CodeSentinel GitHub App server listening on http://127.0.0.1:${port}`)
  })
}
