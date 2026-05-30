import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createExamplePullRequestPayload } from './reviewPipeline.js'
import { loadAiReviewerConfig } from '../config/aiReviewerConfig.js'

const githubApiBaseUrl = 'https://api.github.com'

function parseRepositoryFullName(fullName) {
  const [owner, repo] = String(fullName ?? '').split('/')

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository full name: ${fullName}`)
  }

  return { owner, repo }
}

function buildHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'CodeSentinel-AI-Review',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

async function requestJson(url, { token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: buildHeaders(token) })

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${url}`)
  }

  return response.json()
}

function decodeBase64Content(content) {
  return Buffer.from(String(content ?? '').replace(/\n/g, ''), 'base64').toString('utf8')
}

function parseIssueNumbers(text) {
  const numbers = new Set()
  const patterns = [
    /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi,
    /(?:issue|需求|缺陷|任务)\s*#?(\d+)/gi,
  ]

  for (const pattern of patterns) {
    for (const match of String(text ?? '').matchAll(pattern)) {
      numbers.add(Number(match[1]))
    }
  }

  return [...numbers].filter(Number.isFinite).slice(0, 5)
}

function normalizeChangedFile(file) {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch ?? '',
    rawUrl: file.raw_url ?? '',
    blobUrl: file.blob_url ?? '',
  }
}

async function readRepoFile({ owner, repo, filePath, ref, token, fetchImpl }) {
  const url = `${githubApiBaseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`
  const content = await requestJson(url, { token, fetchImpl })

  if (content.type !== 'file' || !content.content) {
    return null
  }

  return {
    path: filePath,
    sha: content.sha,
    size: content.size,
    content: decodeBase64Content(content.content),
  }
}

async function collectDependencyFiles({ owner, repo, ref, reviewConfig, token, fetchImpl }) {
  if (!reviewConfig.context.includeDependencyFiles) {
    return []
  }

  const dependencyFiles = []

  for (const filePath of reviewConfig.context.dependencyFiles) {
    try {
      const file = await readRepoFile({ owner, repo, filePath, ref, token, fetchImpl })

      if (file) {
        dependencyFiles.push(file)
      }
    } catch {
      dependencyFiles.push({ path: filePath, missing: true, content: '' })
    }
  }

  return dependencyFiles
}

async function collectFullFiles({ owner, repo, ref, changedFiles, reviewConfig, token, fetchImpl }) {
  if (!reviewConfig.context.includeFullFiles) {
    return []
  }

  const fullFiles = []
  const limitedChangedFiles = changedFiles.slice(0, 12)

  for (const file of limitedChangedFiles) {
    try {
      const fullFile = await readRepoFile({ owner, repo, filePath: file.filename, ref, token, fetchImpl })

      if (fullFile) {
        fullFiles.push(fullFile)
      }
    } catch {
      fullFiles.push({ path: file.filename, missing: true, content: '' })
    }
  }

  return fullFiles
}

async function collectIssues({ owner, repo, pullRequest, token, fetchImpl }) {
  const issueNumbers = parseIssueNumbers(`${pullRequest.title}\n${pullRequest.body}`)
  const issues = []

  for (const issueNumber of issueNumbers) {
    try {
      const issue = await requestJson(`${githubApiBaseUrl}/repos/${owner}/${repo}/issues/${issueNumber}`, { token, fetchImpl })
      issues.push({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels?.map((label) => label.name) ?? [],
        body: issue.body ?? '',
        url: issue.html_url,
      })
    } catch {
      issues.push({ number: issueNumber, missing: true })
    }
  }

  return issues
}

async function collectHistoricalSnippets({ owner, repo, ref, reviewConfig, token, fetchImpl }) {
  const tree = await requestJson(`${githubApiBaseUrl}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
    token,
    fetchImpl,
  })
  const criticalPaths = reviewConfig.guardrails.criticalPaths
  const candidateFiles = (tree.tree ?? [])
    .filter((item) => item.type === 'blob')
    .filter((item) => criticalPaths.some((criticalPath) => item.path?.startsWith(criticalPath)))
    .filter((item) => /\.(js|jsx|ts|tsx|mjs|cjs|json|yml|yaml|md)$/.test(item.path))
    .slice(0, 8)
  const snippets = []

  for (const item of candidateFiles) {
    try {
      const file = await readRepoFile({ owner, repo, filePath: item.path, ref, token, fetchImpl })

      if (file?.content) {
        snippets.push({
          path: file.path,
          source: 'historical-good-slices',
          content: file.content.slice(0, 2400),
        })
      }
    } catch {
      // Historical snippets are best-effort context; analysis can continue without them.
    }
  }

  return snippets
}

export async function fetchGitHubPullRequestContext({ payload, reviewConfig, token = process.env.GITHUB_TOKEN, fetchImpl = fetch }) {
  const repository = payload.repository ?? {}
  const pullRequest = payload.pull_request ?? {}
  const { owner, repo } = parseRepositoryFullName(repository.full_name)
  const ref = pullRequest.head?.sha ?? pullRequest.head?.ref ?? repository.default_branch ?? 'main'
  const baseRef = pullRequest.base?.sha ?? pullRequest.base?.ref ?? repository.default_branch ?? 'main'
  const number = pullRequest.number

  if (!number) {
    throw new Error('GitHub webhook payload is missing pull_request.number')
  }

  const changedFiles = await requestJson(`${githubApiBaseUrl}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`, {
    token,
    fetchImpl,
  }).then((files) => files.map(normalizeChangedFile))

  const [fullFiles, dependencyFiles, issues, historicalSnippets] = await Promise.all([
    collectFullFiles({ owner, repo, ref, changedFiles, reviewConfig, token, fetchImpl }),
    collectDependencyFiles({ owner, repo, ref, reviewConfig, token, fetchImpl }),
    collectIssues({ owner, repo, pullRequest, token, fetchImpl }),
    collectHistoricalSnippets({ owner, repo, ref: baseRef, reviewConfig, token, fetchImpl }).catch(() => []),
  ])

  return {
    source: token ? 'github-api-authenticated' : 'github-api-public',
    repository: repository.full_name,
    pullRequest: {
      number,
      title: pullRequest.title ?? '',
      body: pullRequest.body ?? '',
      headSha: pullRequest.head?.sha ?? '',
      baseSha: pullRequest.base?.sha ?? '',
    },
    changedFiles,
    fullFiles,
    dependencyFiles,
    issues,
    jira: {
      enabled: Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_API_TOKEN),
      items: [],
      reason: 'Jira context is configured separately and will be resolved in the enterprise connector step.',
    },
    historicalSnippets,
  }
}

export function buildContextFilesForAnalysis(githubContext) {
  return [
    ...(githubContext?.changedFiles ?? []),
    ...(githubContext?.dependencyFiles ?? []).map((file) => ({
      filename: file.path,
      status: file.missing ? 'missing' : 'context',
      patch: file.content,
    })),
    ...(githubContext?.historicalSnippets ?? []).map((snippet) => ({
      filename: snippet.path,
      status: 'historical',
      patch: snippet.content,
    })),
  ]
}

async function runCheck() {
  const { config } = await loadAiReviewerConfig()
  const payload = createExamplePullRequestPayload()
  payload.pull_request.body = 'Fixes #7'
  const responses = new Map([
    [`${githubApiBaseUrl}/repos/acme/codesentinel/pulls/42/files?per_page=100`, [
      { filename: 'server/api/auth.js', status: 'modified', additions: 12, deletions: 2, changes: 14, patch: '+ validate tenant auth before merge' },
    ]],
    [`${githubApiBaseUrl}/repos/acme/codesentinel/contents/server/api/auth.js?ref=7f4a8c6b2d1e9a0f1b2c3d4e5f67890123456789`, {
      type: 'file',
      sha: 'file-sha',
      size: 32,
      content: Buffer.from('export function validateTenantAuth() {}').toString('base64'),
    }],
    [`${githubApiBaseUrl}/repos/acme/codesentinel/contents/package.json?ref=7f4a8c6b2d1e9a0f1b2c3d4e5f67890123456789`, {
      type: 'file',
      sha: 'pkg-sha',
      size: 20,
      content: Buffer.from('{"name":"codesentinel"}').toString('base64'),
    }],
    [`${githubApiBaseUrl}/repos/acme/codesentinel/contents/package-lock.json?ref=7f4a8c6b2d1e9a0f1b2c3d4e5f67890123456789`, {
      type: 'file',
      sha: 'lock-sha',
      size: 20,
      content: Buffer.from('{"lockfileVersion":3}').toString('base64'),
    }],
    [`${githubApiBaseUrl}/repos/acme/codesentinel/issues/7`, {
      number: 7,
      title: 'Protect tenant auth',
      state: 'open',
      labels: [{ name: 'security' }],
      body: 'Require tenant isolation.',
      html_url: 'https://github.com/acme/codesentinel/issues/7',
    }],
    [`${githubApiBaseUrl}/repos/acme/codesentinel/git/trees/main?recursive=1`, {
      tree: [{ type: 'blob', path: 'server/api/guard.js' }],
    }],
    [`${githubApiBaseUrl}/repos/acme/codesentinel/contents/server/api/guard.js?ref=main`, {
      type: 'file',
      sha: 'guard-sha',
      size: 20,
      content: Buffer.from('export const guard = true').toString('base64'),
    }],
  ])
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 404,
    json: async () => responses.get(url),
  })
  const context = await fetchGitHubPullRequestContext({ payload, reviewConfig: config, token: '', fetchImpl })

  if (!context.changedFiles.length || !context.fullFiles.length || !context.dependencyFiles.length || !context.issues.length) {
    throw new Error('GitHub context client self-check failed')
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        changedFiles: context.changedFiles.length,
        fullFiles: context.fullFiles.length,
        dependencyFiles: context.dependencyFiles.length,
        issues: context.issues.length,
        historicalSnippets: context.historicalSnippets.length,
      },
      null,
      2,
    ),
  )
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
