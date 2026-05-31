import { createPrivateKey, createSign, generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuntimeEnvSync } from '../config/runtimeConfigStore.js'

const githubApiBaseUrl = 'https://api.github.com'

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function normalizePrivateKey(privateKey) {
  return String(privateKey ?? '').replace(/\\n/g, '\n').trim()
}

async function readConfiguredPrivateKey(env) {
  if (env.GITHUB_PRIVATE_KEY_PATH) {
    return readFile(path.resolve(env.GITHUB_PRIVATE_KEY_PATH), 'utf8')
  }

  return env.GITHUB_PRIVATE_KEY
}

export function createGitHubAppJwt({ appId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  if (!appId) {
    throw new Error('GITHUB_APP_ID is required')
  }

  if (!privateKey) {
    throw new Error('GITHUB_PRIVATE_KEY is required')
  }

  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: String(appId),
  }
  const encodedHeader = base64Url(JSON.stringify(header))
  const encodedPayload = base64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signer = createSign('RSA-SHA256')

  signer.update(signingInput)
  signer.end()

  const signature = signer.sign(createPrivateKey(normalizePrivateKey(privateKey)), 'base64url')

  return `${signingInput}.${signature}`
}

export async function createInstallationAccessToken({
  appId,
  privateKey,
  installationId,
  fetchImpl = fetch,
}) {
  if (!installationId) {
    throw new Error('GITHUB_INSTALLATION_ID is required')
  }

  const jwt = createGitHubAppJwt({ appId, privateKey })
  const response = await fetchImpl(`${githubApiBaseUrl}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      'user-agent': 'CodeSentinel-AI-Review',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({}),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.message ?? `GitHub App token request failed with status ${response.status}`)
  }

  return {
    token: payload.token,
    expiresAt: payload.expires_at,
    permissions: payload.permissions ?? {},
    repositories: payload.repositories?.map((repo) => repo.full_name) ?? [],
  }
}

export async function resolveGitHubApiToken({ env = getRuntimeEnvSync(), fetchImpl = fetch } = {}) {
  if (env.GITHUB_APP_ID && (env.GITHUB_PRIVATE_KEY || env.GITHUB_PRIVATE_KEY_PATH) && env.GITHUB_INSTALLATION_ID) {
    const privateKey = await readConfiguredPrivateKey(env)
    const installation = await createInstallationAccessToken({
      appId: env.GITHUB_APP_ID,
      privateKey,
      installationId: env.GITHUB_INSTALLATION_ID,
      fetchImpl,
    })

    return {
      source: 'github-app-installation',
      token: installation.token,
      expiresAt: installation.expiresAt,
      permissions: installation.permissions,
      repositories: installation.repositories,
    }
  }

  if (env.GITHUB_TOKEN) {
    return {
      source: 'github-token',
      token: env.GITHUB_TOKEN,
      expiresAt: null,
      permissions: {},
      repositories: [],
    }
  }

  return {
    source: 'none',
    token: '',
    expiresAt: null,
    permissions: {},
    repositories: [],
  }
}

async function runCheck() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
  })
  const jwt = createGitHubAppJwt({ appId: '123', privateKey, now: 1_700_000_000 })
  const fetchImpl = async (url, options) => ({
    ok: url === `${githubApiBaseUrl}/app/installations/456/access_tokens` && options.headers.authorization.startsWith('Bearer '),
    status: 201,
    json: async () => ({
      token: 'installation-token',
      expires_at: '2026-01-01T00:00:00Z',
      permissions: { checks: 'write' },
      repositories: [{ full_name: 'acme/codesentinel' }],
    }),
  })
  const resolved = await resolveGitHubApiToken({
    env: {
      GITHUB_APP_ID: '123',
      GITHUB_PRIVATE_KEY: privateKey,
      GITHUB_INSTALLATION_ID: '456',
    },
    fetchImpl,
  })

  if (jwt.split('.').length !== 3 || resolved.token !== 'installation-token') {
    throw new Error('GitHub App auth self-check failed')
  }

  console.log(JSON.stringify({ ok: true, source: resolved.source, repositories: resolved.repositories.length }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
