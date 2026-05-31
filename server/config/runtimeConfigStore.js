import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const runtimeConfigKeys = [
  'PORT',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
  'GITHUB_APP_ID',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_PRIVATE_KEY_PATH',
  'GITHUB_INSTALLATION_ID',
  'WEBHOOK_AUTO_PUBLISH',
  'WEBHOOK_ASYNC_PROCESSING',
  'AI_REVIEWER_CONFIG_PATH',
  'FEEDBACK_STORE_PATH',
  'REVIEW_RUN_STORE_PATH',
  'AI_DEFAULT_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_SUMMARY_MODEL',
  'OPENAI_RISK_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_SUMMARY_MODEL',
  'ANTHROPIC_RISK_MODEL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_SUMMARY_MODEL',
  'DEEPSEEK_RISK_MODEL',
  'QWEN_API_KEY',
  'QWEN_BASE_URL',
  'QWEN_SUMMARY_MODEL',
  'QWEN_RISK_MODEL',
]

const secretKeys = new Set([
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
  'GITHUB_PRIVATE_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'QWEN_API_KEY',
])

export function getRuntimeConfigPath(env = process.env) {
  return path.resolve(env.RUNTIME_CONFIG_PATH ?? 'data/runtime-config.json')
}

function cleanConfig(input = {}) {
  return runtimeConfigKeys.reduce((config, key) => {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      config[key] = String(input[key] ?? '').trim()
    }

    return config
  }, {})
}

function maskSecret(value) {
  if (!value) {
    return ''
  }

  if (value.length <= 8) {
    return '********'
  }

  return `${'*'.repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`
}

export async function readRuntimeConfig({ includeSecrets = false, configPath = getRuntimeConfigPath() } = {}) {
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf8'))
    return formatRuntimeConfig(raw, { includeSecrets })
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return formatRuntimeConfig({}, { includeSecrets })
    }

    throw error
  }
}

export function readRuntimeConfigSync({ includeSecrets = false, configPath = getRuntimeConfigPath() } = {}) {
  if (!existsSync(configPath)) {
    return formatRuntimeConfig({}, { includeSecrets })
  }

  return formatRuntimeConfig(JSON.parse(readFileSync(configPath, 'utf8')), { includeSecrets })
}

export function getRuntimeEnvSync() {
  const localConfig = readRuntimeConfigSync({ includeSecrets: true })

  return {
    ...process.env,
    ...localConfig.values,
  }
}

export async function saveRuntimeConfig(input, { configPath = getRuntimeConfigPath() } = {}) {
  const current = await readRuntimeConfig({ includeSecrets: true, configPath })
  const next = cleanConfig({ ...current.values, ...input })

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

  return formatRuntimeConfig(next, { includeSecrets: false })
}

export function formatRuntimeConfig(values, { includeSecrets }) {
  const cleanValues = cleanConfig(values)

  return {
    path: getRuntimeConfigPath(),
    values: includeSecrets
      ? cleanValues
      : runtimeConfigKeys.reduce((visible, key) => {
          visible[key] = secretKeys.has(key) ? '' : cleanValues[key] ?? ''
          return visible
        }, {}),
    fields: runtimeConfigKeys.map((key) => {
      const value = cleanValues[key] ?? ''
      const secret = secretKeys.has(key)

      return {
        key,
        secret,
        configured: Boolean(value),
        value: includeSecrets || !secret ? value : '',
        maskedValue: secret ? maskSecret(value) : value,
      }
    }),
  }
}

async function runCheck() {
  const configPath = path.join(os.tmpdir(), `codesentinel-runtime-config-${Date.now()}.json`)
  const saved = await saveRuntimeConfig(
    {
      AI_DEFAULT_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-test-runtime',
      DEEPSEEK_RISK_MODEL: 'deepseek-reasoner',
    },
    { configPath },
  )
  const loaded = await readRuntimeConfig({ includeSecrets: true, configPath })
  await rm(configPath, { force: true })

  if (!saved.fields.find((field) => field.key === 'DEEPSEEK_API_KEY')?.configured || loaded.values.DEEPSEEK_API_KEY !== 'sk-test-runtime') {
    throw new Error('Runtime config store self-check failed')
  }

  console.log(JSON.stringify({ ok: true, path: configPath, configured: saved.fields.filter((field) => field.configured).length }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
