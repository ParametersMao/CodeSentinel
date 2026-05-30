import path from 'node:path'
import { fileURLToPath } from 'node:url'

const providerDefaults = {
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrlEnv: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    summaryModelEnv: 'OPENAI_SUMMARY_MODEL',
    riskModelEnv: 'OPENAI_RISK_MODEL',
    defaultSummaryModel: 'gpt-4o-mini',
    defaultRiskModel: 'gpt-4o',
  },
  anthropic: {
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    defaultBaseUrl: 'https://api.anthropic.com',
    summaryModelEnv: 'ANTHROPIC_SUMMARY_MODEL',
    riskModelEnv: 'ANTHROPIC_RISK_MODEL',
    defaultSummaryModel: 'claude-3-5-haiku-latest',
    defaultRiskModel: 'claude-3-5-sonnet-latest',
  },
  deepseek: {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com',
    summaryModelEnv: 'DEEPSEEK_SUMMARY_MODEL',
    riskModelEnv: 'DEEPSEEK_RISK_MODEL',
    defaultSummaryModel: 'deepseek-chat',
    defaultRiskModel: 'deepseek-reasoner',
  },
  qwen: {
    apiKeyEnv: 'QWEN_API_KEY',
    baseUrlEnv: 'QWEN_BASE_URL',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    summaryModelEnv: 'QWEN_SUMMARY_MODEL',
    riskModelEnv: 'QWEN_RISK_MODEL',
    defaultSummaryModel: 'qwen-turbo',
    defaultRiskModel: 'qwen-plus',
  },
  local: {
    apiKeyEnv: '',
    baseUrlEnv: '',
    defaultBaseUrl: '',
    summaryModelEnv: '',
    riskModelEnv: '',
    defaultSummaryModel: 'fast-summary',
    defaultRiskModel: 'strong-reasoning',
  },
}

function readEnv(env, key, fallback = '') {
  return key ? env[key] || fallback : fallback
}

function resolveProviderName(routeProvider, env) {
  if (routeProvider && routeProvider !== 'env') {
    return routeProvider
  }

  return env.AI_DEFAULT_PROVIDER || 'local'
}

function resolveModelName({ routeModel, task, providerConfig, env }) {
  if (routeModel && !['summary', 'risk', 'architecture', 'intent'].includes(routeModel)) {
    return routeModel
  }

  if (task === 'summary' || task === 'intent') {
    return readEnv(env, providerConfig.summaryModelEnv, providerConfig.defaultSummaryModel)
  }

  return readEnv(env, providerConfig.riskModelEnv, providerConfig.defaultRiskModel)
}

export function resolveModelRuntime(route, env = process.env) {
  const provider = resolveProviderName(route.provider, env)
  const providerConfig = providerDefaults[provider] ?? providerDefaults.local
  const apiKeyEnv = providerConfig.apiKeyEnv
  const credentialConfigured = apiKeyEnv ? Boolean(env[apiKeyEnv]) : provider === 'local'

  return {
    provider,
    model: resolveModelName({ routeModel: route.model, task: route.task, providerConfig, env }),
    baseUrl: readEnv(env, providerConfig.baseUrlEnv, providerConfig.defaultBaseUrl),
    apiKeyEnv,
    credentialConfigured,
  }
}

export function listSupportedModelProviders() {
  return Object.keys(providerDefaults)
}

async function runCheck() {
  const runtime = resolveModelRuntime(
    { task: 'risk', provider: 'env', model: 'risk' },
    {
      AI_DEFAULT_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_RISK_MODEL: 'deepseek-reasoner',
    },
  )

  if (runtime.provider !== 'deepseek' || runtime.model !== 'deepseek-reasoner' || !runtime.credentialConfigured) {
    throw new Error('Model runtime self-check failed')
  }

  console.log(JSON.stringify({ ok: true, provider: runtime.provider, model: runtime.model, credentialConfigured: runtime.credentialConfigured }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
