import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAiReviewerConfig } from '../config/aiReviewerConfig.js'
import { createExamplePullRequestPayload, createPullRequestJob } from '../github/reviewPipeline.js'
import { callChatModel } from '../models/llmClient.js'
import { buildModelRoutePlan } from '../models/modelRouter.js'
import { retrieveReviewContext } from '../rag/contextRetriever.js'
import { runRuleEngine } from '../rules/ruleEngine.js'

function compactText(value, maxLength = 8000) {
  const text = String(value ?? '')

  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...truncated` : text
}

function buildPrompt({ job, ruleAnalysis, ragContext, githubContext }) {
  return [
    '你是 CodeSentinel 的 AI 代码评审 Agent，面向中国企业研发团队。',
    '请基于输入的 PR、规则引擎结果和上下文，生成结构化 Review。',
    '要求：只输出 JSON，不要 Markdown，不要额外解释。',
    'JSON Schema:',
    '{"summary":"string","risks":[{"severity":"P0|P1|P2","title":"string","evidence":"string","suggestion":"string"}],"checklist":["string"],"comment":"string"}',
    '',
    `PR: ${JSON.stringify(job.pullRequest)}`,
    `规则引擎结果: ${compactText(JSON.stringify(ruleAnalysis), 6000)}`,
    `RAG 上下文: ${compactText(JSON.stringify(ragContext.hits ?? []), 6000)}`,
    `GitHub 上下文: ${compactText(JSON.stringify(githubContext ?? null), 5000)}`,
  ].join('\n')
}

function findRoute(modelRoutePlan, task) {
  return modelRoutePlan.routes.find((route) => route.task === task) ?? modelRoutePlan.routes[0]
}

function normalizeAiReview(raw) {
  return {
    summary: String(raw.summary ?? ''),
    risks: Array.isArray(raw.risks)
      ? raw.risks.slice(0, 8).map((risk) => ({
          severity: String(risk.severity ?? 'P2'),
          title: String(risk.title ?? ''),
          evidence: String(risk.evidence ?? ''),
          suggestion: String(risk.suggestion ?? ''),
        }))
      : [],
    checklist: Array.isArray(raw.checklist) ? raw.checklist.slice(0, 8).map(String) : [],
    comment: String(raw.comment ?? ''),
  }
}

export async function generateAiReview({ job, ruleAnalysis, ragContext, githubContext = null, modelRoutePlan, fetchImpl }) {
  const route = findRoute(modelRoutePlan, ruleAnalysis.blockers?.length ? 'risk' : 'summary')
  const result = await callChatModel({
    route,
    messages: [
      {
        role: 'system',
        content: '你是严谨的企业级代码评审助手。你必须减少误报，明确证据和取舍，只输出合法 JSON。',
      },
      {
        role: 'user',
        content: buildPrompt({ job, ruleAnalysis, ragContext, githubContext }),
      },
    ],
    temperature: 0.2,
    fetchImpl,
  })

  return {
    status: 'generated',
    route: {
      task: route.task,
      provider: route.provider,
      model: route.model,
      credentialConfigured: route.credentialConfigured,
    },
    usage: result.usage,
    review: normalizeAiReview(result.parsed),
  }
}

export function buildFallbackAiReview({ ruleAnalysis, ragContext }) {
  return {
    status: 'fallback',
    route: null,
    usage: null,
    review: {
      summary: `规则引擎发现 ${ruleAnalysis.findings.length} 个风险，其中 ${ruleAnalysis.blockers.length} 个为 P0 Blocker。`,
      risks: ruleAnalysis.findings.map((finding) => ({
        severity: finding.severity,
        title: finding.title,
        evidence: finding.evidence,
        suggestion: finding.suggestion,
      })),
      checklist: ruleAnalysis.checklist,
      comment: [
        '## CodeSentinel 变更验收报告',
        '',
        `合并状态：${ruleAnalysis.mergeGate.reason}`,
        `RAG 上下文：${ragContext.hits?.length ?? 0} 条召回`,
      ].join('\n'),
    },
  }
}

async function runCheck() {
  const { config } = await loadAiReviewerConfig()
  const job = createPullRequestJob(createExamplePullRequestPayload(), 'pull_request', { reviewConfig: config })
  const files = [{ filename: 'server/api/auth.js', patch: '+ validate tenant auth before merge' }]
  const ruleAnalysis = runRuleEngine({ job, reviewConfig: config, files })
  const modelRoutePlan = buildModelRoutePlan({ reviewConfig: config, ruleAnalysis })
  const ragContext = retrieveReviewContext({ query: 'tenant auth merge', reviewConfig: config, files })
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: '本次 PR 修改了租户权限校验。',
              risks: [{ severity: 'P0', title: '租户隔离风险', evidence: '命中 tenant/auth', suggestion: '补充权限前置校验' }],
              checklist: ['补充租户隔离测试'],
              comment: '建议先处理 P0 风险。',
            }),
          },
        },
      ],
      usage: { total_tokens: 42 },
    }),
  })
  const aiReview = await generateAiReview({ job, ruleAnalysis, ragContext, modelRoutePlan, fetchImpl })

  if (aiReview.review.risks.length !== 1 || aiReview.status !== 'generated') {
    throw new Error('AI review service self-check failed')
  }

  console.log(JSON.stringify({ ok: true, status: aiReview.status, risks: aiReview.review.risks.length }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
