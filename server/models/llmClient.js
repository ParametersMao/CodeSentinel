import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuntimeEnvSync } from '../config/runtimeConfigStore.js'

function trimTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/, '')
}

function parseJsonContent(text) {
  const content = String(text ?? '').trim()
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonText = fenced ? fenced[1].trim() : content

  return JSON.parse(jsonText)
}

export async function callChatModel({ route, messages, temperature = 0.2, responseFormat = 'json_object', fetchImpl = fetch, env = getRuntimeEnvSync() }) {
  if (!route.credentialConfigured) {
    throw new Error(`Model credential is not configured: ${route.apiKeyEnv || route.provider}`)
  }

  if (route.provider === 'anthropic') {
    throw new Error('Anthropic adapter is planned but not implemented in this MVP step')
  }

  if (!['openai', 'deepseek', 'qwen'].includes(route.provider)) {
    throw new Error(`Unsupported chat provider: ${route.provider}`)
  }

  const apiKey = env[route.apiKeyEnv]
  const response = await fetchImpl(`${trimTrailingSlash(route.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages,
      temperature,
      response_format: responseFormat ? { type: responseFormat } : undefined,
    }),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Model request failed with status ${response.status}`)
  }

  const content = payload.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('Model response did not include message content')
  }

  return {
    provider: route.provider,
    model: route.model,
    content,
    parsed: responseFormat === 'json_object' ? parseJsonContent(content) : null,
    usage: payload.usage ?? null,
  }
}

async function runCheck() {
  const route = {
    provider: 'deepseek',
    model: 'deepseek-test',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    credentialConfigured: true,
  }
  const fetchImpl = async (url, options) => ({
    ok: url === 'https://api.deepseek.com/chat/completions' && options.headers.authorization === 'Bearer test-key',
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '{"summary":"ok","risks":[],"checklist":[],"comment":"ok"}' } }],
      usage: { total_tokens: 12 },
    }),
  })
  const result = await callChatModel({
    route,
    messages: [{ role: 'user', content: 'Return JSON' }],
    fetchImpl,
    env: { DEEPSEEK_API_KEY: 'test-key' },
  })

  if (result.parsed.summary !== 'ok') {
    throw new Error('LLM client self-check failed')
  }

  console.log(JSON.stringify({ ok: true, provider: result.provider, model: result.model }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
