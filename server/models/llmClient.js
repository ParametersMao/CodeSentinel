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

function splitAnthropicMessages(messages) {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
  const conversation = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content ?? ''),
    }))

  return { system, conversation }
}

async function callAnthropicMessages({ route, messages, temperature, responseFormat, fetchImpl, env }) {
  const apiKey = env[route.apiKeyEnv]
  const { system, conversation } = splitAnthropicMessages(messages)
  const response = await fetchImpl(`${trimTrailingSlash(route.baseUrl)}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      max_tokens: 2048,
      temperature,
      system: responseFormat === 'json_object' ? `${system}\n\nReturn only valid JSON.`.trim() : system || undefined,
      messages: conversation.length ? conversation : [{ role: 'user', content: 'Return a review result.' }],
    }),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Anthropic request failed with status ${response.status}`)
  }

  const content = payload.content?.map((item) => item.text).filter(Boolean).join('\n')

  if (!content) {
    throw new Error('Anthropic response did not include text content')
  }

  return {
    provider: route.provider,
    model: route.model,
    content,
    parsed: responseFormat === 'json_object' ? parseJsonContent(content) : null,
    usage: payload.usage
      ? {
          prompt_tokens: payload.usage.input_tokens,
          completion_tokens: payload.usage.output_tokens,
          total_tokens: (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0),
        }
      : null,
  }
}

export async function callChatModel({ route, messages, temperature = 0.2, responseFormat = 'json_object', fetchImpl = fetch, env = getRuntimeEnvSync() }) {
  if (!route.credentialConfigured) {
    throw new Error(`Model credential is not configured: ${route.apiKeyEnv || route.provider}`)
  }

  if (route.provider === 'anthropic') {
    return callAnthropicMessages({ route, messages, temperature, responseFormat, fetchImpl, env })
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
  const anthropicResult = await callChatModel({
    route: {
      provider: 'anthropic',
      model: 'claude-test',
      baseUrl: 'https://api.anthropic.com',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      credentialConfigured: true,
    },
    messages: [{ role: 'user', content: 'Return JSON' }],
    fetchImpl: async (url, options) => ({
      ok: url === 'https://api.anthropic.com/v1/messages' && options.headers['x-api-key'] === 'anthropic-key',
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"summary":"anthropic-ok","risks":[],"checklist":[],"comment":"ok"}' }],
        usage: { input_tokens: 10, output_tokens: 8 },
      }),
    }),
    env: { ANTHROPIC_API_KEY: 'anthropic-key' },
  })

  if (anthropicResult.parsed.summary !== 'anthropic-ok') {
    throw new Error('Anthropic LLM client self-check failed')
  }

  console.log(JSON.stringify({ ok: true, providers: [result.provider, anthropicResult.provider] }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
