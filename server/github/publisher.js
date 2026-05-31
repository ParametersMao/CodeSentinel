import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFallbackAiReview } from '../review/aiReviewService.js'
import { resolveGitHubApiToken } from './appAuth.js'

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
    'content-type': 'application/json',
    'user-agent': 'CodeSentinel-AI-Review',
    'x-github-api-version': '2022-11-28',
    authorization: `Bearer ${token}`,
  }
}

async function postGitHubJson(url, body, { token, fetchImpl = fetch }) {
  if (!token) {
    throw new Error('GITHUB_TOKEN is required to publish GitHub review results')
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.message ?? `GitHub publish failed with status ${response.status}`)
  }

  return payload
}

function severityIcon(severity) {
  if (severity === 'P0') return '⛔'
  if (severity === 'P1') return '⚠️'
  return 'ℹ️'
}

export function formatReviewComment({ aiReview, ruleAnalysis, modelRoutePlan, ragContext }) {
  const review = aiReview.review
  const route = aiReview.route
  const risks = review.risks.length ? review.risks : ruleAnalysis.findings

  return [
    '## CodeSentinel 变更验收报告',
    '',
    `**生成状态**：${aiReview.status}`,
    `**合并闸口**：${ruleAnalysis.mergeGate.reason}`,
    `**模型路由**：${route ? `${route.provider}/${route.model}` : modelRoutePlan.mode}`,
    `**上下文召回**：${ragContext.hits?.length ?? 0} 条`,
    '',
    '### PR 摘要',
    review.summary || '暂无模型摘要，已回退到规则引擎结果。',
    '',
    '### 核心风险',
    ...risks.slice(0, 6).map((risk) => `- ${severityIcon(risk.severity)} **${risk.severity} ${risk.title}**：${risk.evidence || risk.suggestion}`),
    '',
    '### Checklist',
    ...(review.checklist.length ? review.checklist : ruleAnalysis.checklist).slice(0, 8).map((item) => `- [ ] ${item}`),
    '',
    '<sub>由 CodeSentinel 自动生成。P0/P1 会优先影响合并闸口，P2 默认进入 Checklist。</sub>',
  ].join('\n')
}

export function buildCheckRunPayload({ job, aiReview, ruleAnalysis, ragContext }) {
  const failure = ruleAnalysis.mergeGate.state === 'failure'
  const title = failure ? 'CodeSentinel 发现阻断级风险' : 'CodeSentinel Review 通过'
  const summary = [
    aiReview.review.summary,
    '',
    `风险数：${aiReview.review.risks.length || ruleAnalysis.findings.length}`,
    `P0 Blocker：${ruleAnalysis.blockers.length}`,
    `RAG 召回：${ragContext.hits?.length ?? 0}`,
  ].join('\n')

  return {
    name: 'CodeSentinel AI Review',
    head_sha: job.pullRequest.headSha,
    status: 'completed',
    conclusion: failure ? 'failure' : 'success',
    output: {
      title,
      summary,
      text: formatReviewComment({
        aiReview,
        ruleAnalysis,
        modelRoutePlan: { mode: 'published' },
        ragContext,
      }).slice(0, 60000),
    },
  }
}

export async function createCheckRun({ job, aiReview, ruleAnalysis, ragContext, token, fetchImpl }) {
  const { owner, repo } = parseRepositoryFullName(job.repository.fullName)
  const payload = buildCheckRunPayload({ job, aiReview, ruleAnalysis, ragContext })

  return postGitHubJson(`${githubApiBaseUrl}/repos/${owner}/${repo}/check-runs`, payload, { token, fetchImpl })
}

export async function createPullRequestComment({ job, aiReview, ruleAnalysis, modelRoutePlan, ragContext, token, fetchImpl }) {
  const { owner, repo } = parseRepositoryFullName(job.repository.fullName)
  const body = formatReviewComment({ aiReview, ruleAnalysis, modelRoutePlan, ragContext })

  return postGitHubJson(
    `${githubApiBaseUrl}/repos/${owner}/${repo}/issues/${job.pullRequest.number}/comments`,
    { body },
    { token, fetchImpl },
  )
}

export async function publishGitHubReview({ job, aiReview, ruleAnalysis, modelRoutePlan, ragContext, token, fetchImpl }) {
  const tokenResult = token
    ? { source: 'provided-token', token }
    : await resolveGitHubApiToken({ fetchImpl })
  const [checkRun, comment] = await Promise.all([
    createCheckRun({ job, aiReview, ruleAnalysis, ragContext, token: tokenResult.token, fetchImpl }),
    createPullRequestComment({ job, aiReview, ruleAnalysis, modelRoutePlan, ragContext, token: tokenResult.token, fetchImpl }),
  ])

  return {
    status: 'published',
    tokenSource: tokenResult.source,
    checkRun: {
      id: checkRun.id,
      url: checkRun.html_url ?? checkRun.url,
      conclusion: checkRun.conclusion,
    },
    comment: {
      id: comment.id,
      url: comment.html_url ?? comment.url,
    },
  }
}

async function runCheck() {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return {
      ok: true,
      status: 201,
      json: async () =>
        url.endsWith('/check-runs')
          ? { id: 1, conclusion: 'failure', html_url: 'https://github.com/acme/codesentinel/runs/1' }
          : { id: 2, html_url: 'https://github.com/acme/codesentinel/pull/42#issuecomment-2' },
    }
  }
  const job = {
    repository: { fullName: 'acme/codesentinel' },
    pullRequest: { number: 42, headSha: 'abc123' },
  }
  const ruleAnalysis = {
    mergeGate: { state: 'failure', reason: '发现 1 个 P0 Blocker' },
    findings: [{ severity: 'P0', title: '权限绕过', evidence: 'auth bypass', suggestion: 'fix auth' }],
    blockers: [{ severity: 'P0' }],
    checklist: ['补充权限测试'],
  }
  const ragContext = { hits: [{ id: 'context' }] }
  const aiReview = buildFallbackAiReview({ ruleAnalysis, ragContext })
  const result = await publishGitHubReview({
    job,
    aiReview,
    ruleAnalysis,
    modelRoutePlan: { mode: 'deep-review' },
    ragContext,
    token: 'test-token',
    fetchImpl,
  })

  if (result.status !== 'published' || calls.length !== 2 || !calls[0].body.head_sha || !calls[1].body.body) {
    throw new Error('GitHub publisher self-check failed')
  }

  console.log(JSON.stringify({ ok: true, calls: calls.length, status: result.status }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
