import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFallbackAiReview } from '../review/aiReviewService.js'
import { resolveGitHubApiToken } from './appAuth.js'

const githubApiBaseUrl = 'https://api.github.com'
const checkRunName = 'CodeSentinel AI Review'

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

async function requestGitHubJson(url, { method, body, token, fetchImpl = fetch }) {
  if (!token) {
    throw new Error('GitHub API token is required to publish review results')
  }

  const response = await fetchImpl(url, {
    method,
    headers: buildHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.message ?? `GitHub publish failed with status ${response.status}`)
  }

  return payload
}

function postGitHubJson(url, body, options) {
  return requestGitHubJson(url, { ...options, method: 'POST', body })
}

function patchGitHubJson(url, body, options) {
  return requestGitHubJson(url, { ...options, method: 'PATCH', body })
}

function severityIcon(severity) {
  if (severity === 'P0') return '⛔'
  if (severity === 'P1') return '⚠️'
  return 'ℹ️'
}

function getEffectiveRisks(aiReview, ruleAnalysis) {
  return aiReview.review.risks.length ? aiReview.review.risks : ruleAnalysis.findings
}

function getEffectiveMergeGate(aiReview, ruleAnalysis) {
  const risks = getEffectiveRisks(aiReview, ruleAnalysis)
  const blockerCount = risks.filter((risk) => risk.severity === 'P0').length
  const seriousCount = risks.filter((risk) => risk.severity === 'P1').length

  if (blockerCount > 0) {
    return {
      state: 'failure',
      reason: `AI 校准后仍发现 ${blockerCount} 个 P0 Blocker`,
      blockerCount,
      seriousCount,
    }
  }

  return {
    state: 'success',
    reason: seriousCount > 0 ? `AI 校准后保留 ${seriousCount} 个 P1 风险，建议人工确认` : 'AI 校准后未发现阻断级风险',
    blockerCount,
    seriousCount,
  }
}

export function formatReviewComment({ aiReview, ruleAnalysis, modelRoutePlan, ragContext }) {
  const review = aiReview.review
  const route = aiReview.route
  const risks = getEffectiveRisks(aiReview, ruleAnalysis)
  const mergeGate = getEffectiveMergeGate(aiReview, ruleAnalysis)

  return [
    '## CodeSentinel 变更验收报告',
    '',
    `**生成状态**：${aiReview.status}`,
    `**合并闸口**：${mergeGate.reason}`,
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
  const mergeGate = getEffectiveMergeGate(aiReview, ruleAnalysis)
  const failure = mergeGate.state === 'failure'
  const title = failure ? 'CodeSentinel 发现阻断级风险' : 'CodeSentinel Review 通过'
  const summary = [
    aiReview.review.summary,
    '',
    `风险数：${getEffectiveRisks(aiReview, ruleAnalysis).length}`,
    `P0 Blocker：${mergeGate.blockerCount}`,
    `RAG 召回：${ragContext.hits?.length ?? 0}`,
  ].join('\n')

  return {
    name: checkRunName,
    head_sha: job.pullRequest.headSha,
    status: 'completed',
    conclusion: failure ? 'failure' : 'success',
    completed_at: new Date().toISOString(),
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

export function buildRunningCheckRunPayload({ job }) {
  return {
    name: checkRunName,
    head_sha: job.pullRequest.headSha,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    output: {
      title: 'CodeSentinel 正在分析 PR',
      summary: '正在并发执行拦截层、意图层和架构层分析，完成后会更新合并闸口和 PR 验收报告。',
    },
  }
}

export async function createRunningCheckRun({ job, token, fetchImpl }) {
  const { owner, repo } = parseRepositoryFullName(job.repository.fullName)
  const payload = buildRunningCheckRunPayload({ job })

  return postGitHubJson(`${githubApiBaseUrl}/repos/${owner}/${repo}/check-runs`, payload, { token, fetchImpl })
}

export async function updateCheckRun({ job, checkRunId, aiReview, ruleAnalysis, ragContext, token, fetchImpl }) {
  const { owner, repo } = parseRepositoryFullName(job.repository.fullName)
  const payload = buildCheckRunPayload({ job, aiReview, ruleAnalysis, ragContext })

  return patchGitHubJson(`${githubApiBaseUrl}/repos/${owner}/${repo}/check-runs/${checkRunId}`, payload, { token, fetchImpl })
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

export async function publishGitHubReviewWithStatusFlow({ job, runAnalysis, token, fetchImpl }) {
  const tokenResult = token
    ? { source: 'provided-token', token }
    : await resolveGitHubApiToken({ fetchImpl })
  const runningCheckRun = await createRunningCheckRun({ job, token: tokenResult.token, fetchImpl })

  try {
    const analysisResult = await runAnalysis()
    const [checkRun, comment] = await Promise.all([
      updateCheckRun({
        job,
        checkRunId: runningCheckRun.id,
        aiReview: analysisResult.aiReview,
        ruleAnalysis: analysisResult.ruleAnalysis,
        ragContext: analysisResult.ragContext,
        token: tokenResult.token,
        fetchImpl,
      }),
      createPullRequestComment({
        job,
        aiReview: analysisResult.aiReview,
        ruleAnalysis: analysisResult.ruleAnalysis,
        modelRoutePlan: analysisResult.modelRoutePlan,
        ragContext: analysisResult.ragContext,
        token: tokenResult.token,
        fetchImpl,
      }),
    ])

    return {
      ...analysisResult,
      publishResult: {
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
      },
    }
  } catch (error) {
    await patchGitHubJson(
      runningCheckRun.url ?? `${githubApiBaseUrl}/repos/${parseRepositoryFullName(job.repository.fullName).owner}/${parseRepositoryFullName(job.repository.fullName).repo}/check-runs/${runningCheckRun.id}`,
      {
        name: checkRunName,
        status: 'completed',
        conclusion: 'failure',
        completed_at: new Date().toISOString(),
        output: {
          title: 'CodeSentinel 分析失败',
          summary: error instanceof Error ? error.message : String(error),
        },
      },
      { token: tokenResult.token, fetchImpl },
    )
    throw error
  }
}

async function runCheck() {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) })
    return {
      ok: true,
      status: options.method === 'PATCH' ? 200 : 201,
      json: async () => {
        if (url.endsWith('/check-runs') && options.method === 'POST') {
          return { id: 1, status: 'in_progress', url: 'https://api.github.com/repos/acme/codesentinel/check-runs/1' }
        }

        if (url.includes('/check-runs/')) {
          return { id: 1, conclusion: 'failure', html_url: 'https://github.com/acme/codesentinel/runs/1' }
        }

        return { id: 2, html_url: 'https://github.com/acme/codesentinel/pull/42#issuecomment-2' }
      },
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
  const result = await publishGitHubReviewWithStatusFlow({
    job,
    token: 'test-token',
    fetchImpl,
    runAnalysis: async () => ({
      ruleAnalysis,
      ragContext,
      aiReview,
      modelRoutePlan: { mode: 'deep-review' },
    }),
  })

  if (
    result.publishResult.status !== 'published' ||
    calls.length !== 3 ||
    calls[0].body.status !== 'in_progress' ||
    calls[1].method !== 'PATCH' ||
    !calls[2].body.body
  ) {
    throw new Error('GitHub publisher self-check failed')
  }

  console.log(JSON.stringify({ ok: true, calls: calls.length, status: result.publishResult.status }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
