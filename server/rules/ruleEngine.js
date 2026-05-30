import { createExamplePullRequestPayload, createPullRequestJob } from '../github/reviewPipeline.js'
import { loadAiReviewerConfig } from '../config/aiReviewerConfig.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ruleCatalog = {
  'auth-bypass': {
    severity: 'P0',
    title: '可能绕过认证或合并保护',
    category: '代码产物',
    signals: ['auth', 'permission', 'branch', 'merge', 'token', 'session'],
    suggestion: '补充认证/权限前置校验，并为绕过路径增加回归测试。',
  },
  'tenant-isolation': {
    severity: 'P0',
    title: '可能破坏租户隔离',
    category: '数据安全',
    signals: ['tenant', 'org', 'workspace', 'account', 'reviews', 'query'],
    suggestion: '确认查询条件包含 tenantId/orgId，并补充跨租户访问测试。',
  },
  'secret-leak': {
    severity: 'P0',
    title: '可能泄露密钥或敏感配置',
    category: '安全红线',
    signals: ['secret', 'private_key', 'api_key', 'password', '.env'],
    suggestion: '移除明文密钥，改用环境变量或密钥管理服务，并轮换已暴露凭证。',
  },
  'unsafe-sql': {
    severity: 'P1',
    title: '可能存在不安全查询拼接',
    category: '数据访问',
    signals: ['sql', 'query', 'where', 'raw', 'concat'],
    suggestion: '使用参数化查询或 ORM 条件构造，避免字符串拼接进入 SQL。',
  },
  'ai-agent-loop': {
    severity: 'P1',
    title: 'AI Agent 修复可能循环改写',
    category: 'AI Agent 轨迹',
    signals: ['prompt', 'agent', 'retry', 'loop', 'fix', 'again'],
    suggestion: '要求 Agent 写明失败原因、停止条件和一次重试后的人工确认点。',
  },
}

const severityScore = {
  P0: 35,
  P1: 18,
  P2: 8,
}

function lowerText(value) {
  return String(value ?? '').toLowerCase()
}

function collectSignalText(job, files = []) {
  const pr = job.pullRequest ?? {}
  const fileText = files
    .map((file) => [file.filename, file.patch, file.status].filter(Boolean).join(' '))
    .join(' ')

  return lowerText([pr.title, pr.head, pr.base, pr.url, fileText].join(' '))
}

function matchesCriticalPath(files, criticalPaths) {
  if (!files.length || !criticalPaths.length) {
    return false
  }

  return files.some((file) => criticalPaths.some((criticalPath) => String(file.filename ?? '').startsWith(criticalPath)))
}

function createFinding(ruleKey, rule, confidence, evidence) {
  return {
    id: `${ruleKey}-${Math.round(confidence * 100)}`,
    rule: ruleKey,
    severity: rule.severity,
    title: rule.title,
    category: rule.category,
    confidence,
    evidence,
    suggestion: rule.suggestion,
  }
}

export function runRuleEngine({ job, reviewConfig, files = [] }) {
  const signalText = collectSignalText(job, files)
  const blockerRules = reviewConfig.guardrails.blockerRules
  const findings = []

  for (const ruleKey of blockerRules) {
    const rule = ruleCatalog[ruleKey]

    if (!rule) {
      continue
    }

    const matchedSignals = rule.signals.filter((signal) => signalText.includes(signal))
    const criticalPathBoost = matchesCriticalPath(files, reviewConfig.guardrails.criticalPaths) ? 0.08 : 0

    if (matchedSignals.length) {
      const confidence = Math.min(0.96, 0.68 + matchedSignals.length * 0.08 + criticalPathBoost)
      findings.push(
        createFinding(
          ruleKey,
          rule,
          confidence,
          `命中信号：${matchedSignals.join('、')}；规则来源：.ai-reviewer.yml`,
        ),
      )
    }
  }

  const visibleFindings = findings.filter(
    (finding) => finding.confidence >= reviewConfig.review.confidenceThreshold || finding.severity === 'P0',
  )
  const blockers = visibleFindings.filter((finding) => finding.severity === 'P0')
  const penalty = visibleFindings.reduce((total, finding) => total + (severityScore[finding.severity] ?? severityScore.P2), 0)
  const healthScore = Math.max(0, 100 - penalty)

  return {
    status: blockers.length ? 'blocked' : 'passed',
    healthScore,
    mergeGate: {
      state: blockers.length ? 'failure' : 'success',
      reason: blockers.length ? `发现 ${blockers.length} 个 P0 Blocker` : '未发现阻断级风险',
    },
    findings: visibleFindings,
    blockers,
    checklist: [
      '确认 PR 描述、Issue 意图和 Diff 改动范围一致。',
      '确认 .ai-reviewer.yml 中的核心目录已被纳入上下文。',
      '为命中的 P0/P1 风险补充回归测试或人工取舍说明。',
    ],
  }
}

async function runCheck() {
  const { config } = await loadAiReviewerConfig()
  const payload = createExamplePullRequestPayload()
  payload.pull_request.title = '新增 tenant auth merge guard'
  const job = createPullRequestJob(payload, 'pull_request', { reviewConfig: config })
  const result = runRuleEngine({
    job,
    reviewConfig: config,
    files: [{ filename: 'server/github/reviewPipeline.js', patch: '+ validate tenant auth before merge' }],
  })

  if (!result.findings.length || result.mergeGate.state !== 'failure') {
    throw new Error('Rule engine self-check failed')
  }

  console.log(JSON.stringify({ ok: true, status: result.status, findings: result.findings.length }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
