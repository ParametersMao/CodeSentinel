import { useMemo, useState } from 'react'
import './App.css'

const samplePrUrl = 'https://github.com/acme/codesentinel/pull/421'

const severityRank = { P0: 3, P1: 2, P2: 1 }

const views = ['接入配置', '评审工作台', '系统设计', '团队洞察']

const sampleReview = {
  source: '演示样例',
  status: 'ready',
  summaryStatus: '可交给评审人',
  ciStatus: '30 秒内完成',
  reportTitle: '变更验收报告',
  healthScore: 82,
  pr: {
    title: '保护分支合并流程与 AI Review Prompt 更新',
    number: 421,
    repo: 'acme/codesentinel',
    author: 'alexdev',
    branch: 'feature/protected-merge-cache',
    base: 'main',
    additions: 842,
    deletions: 442,
  },
  metrics: {
    files: 18,
    changedLines: '1.2k',
    highRiskPaths: 3,
    testsMissing: 2,
  },
  summary:
    '本次 PR 增加合并决策缓存，调整 Review Prompt 与摘要卡片逻辑。主要风险集中在保护分支权限校验顺序、租户数据隔离和 Agent 自动修复指令。建议 QA 覆盖保护分支拒绝合并、缓存失效和组织数据隔离场景。',
  findings: [
    {
      id: 'auth-bypass',
      severity: 'P0',
      file: 'src/api/merge.ts',
      line: 88,
      title: '合并权限校验可能被绕过',
      confidence: 94,
      owner: '代码产物',
      lane: '拦截层',
      impact: '当分支规则缓存命中时，拥有普通写权限的用户可能绕过保护分支校验并完成合并。',
      evidence: '新增的快速返回路径发生在 validateBranchProtection 之前。',
      suggestion: '将 validateBranchProtection 前置到缓存返回之前，并补充缓存命中场景的回归测试。',
    },
    {
      id: 'tenant-leak',
      severity: 'P1',
      file: 'src/db/reviews.ts',
      line: 143,
      title: 'Review 查询可能丢失租户过滤',
      confidence: 89,
      owner: '人类负责人',
      lane: '架构层',
      impact: '企业客户可能在评审看板中看到其他组织的 Review 元数据。',
      evidence: '旧逻辑中的 orgId 条件被删除，但底层仍然使用共享 reviews 表。',
      suggestion: '恢复 orgId 查询条件，并在 repository 测试夹具中加入组织隔离断言。',
    },
    {
      id: 'ai-loop',
      severity: 'P1',
      file: 'prompts/reviewer.md',
      line: 36,
      title: '自动修复 Prompt 可能导致循环改写',
      confidence: 82,
      owner: 'AI Agent 轨迹',
      lane: '意图层',
      impact: '开发者 Agent 可能反复重写同一段代码，却没有说明失败原因和取舍。',
      evidence: 'Prompt 要求修复问题，但没有要求引用失败检查、解释补丁或设置停止条件。',
      suggestion: '要求 Agent 引用失败检查、说明修改原因，并在一次重试仍失败后停止自动改写。',
    },
    {
      id: 'summary-noise',
      severity: 'P2',
      file: 'src/components/SummaryCard.jsx',
      line: 22,
      title: 'PR 摘要缺少测试范围建议',
      confidence: 71,
      owner: '代码产物',
      lane: '反馈层',
      impact: 'QA 可以看到变更摘要，但无法快速判断需要重点回归哪些路径。',
      evidence: '当前摘要只描述功能和文件，没有说明测试面。',
      suggestion: '根据变更路由和 API 追加一段测试范围建议。',
    },
  ],
  checklist: [
    '确认保护分支缓存命中时仍会执行权限校验。',
    '补充组织隔离回归测试，覆盖跨租户读取场景。',
    '要求 Agent Prompt 增加失败解释和停止条件。',
  ],
  diffRows: [
    { type: 'context', old: '82', next: '82', code: 'export async function mergePullRequest(input: MergeInput) {' },
    { type: 'context', old: '83', next: '83', code: '  const branchRule = await branchRules.get(input.baseBranch)' },
    { type: 'removed', old: '84', next: '', code: '  await validateBranchProtection(input.actor, branchRule)' },
    { type: 'added', old: '', next: '84', code: '  const cachedDecision = mergeDecisionCache.get(input.pullRequestId)' },
    { type: 'added', old: '', next: '85', code: '  if (cachedDecision) return cachedDecision' },
    { type: 'context', old: '85', next: '86', code: '  const checks = await checksApi.list(input.pullRequestId)' },
    { type: 'added', old: '', next: '87', code: '  await validateBranchProtection(input.actor, branchRule)' },
    { type: 'context', old: '86', next: '88', code: '  return createMergeDecision({ branchRule, checks })' },
  ],
}

const onboardingModes = {
  new: {
    title: '空白 / 新项目',
    description: '通过 Web 表单补齐架构边界、核心模块、技术栈、禁止事项和测试要求，生成第一版 AI 审查规范。',
    status: '表单引导',
  },
  existing: {
    title: '存量项目',
    description: '拉取 core、api、service、domain 等高频修改目录，抽取隐式代码规范和优秀历史代码切片。',
    status: '自动归纳',
  },
}

const businessFlow = [
  {
    stage: '接入期',
    trigger: '用户授权 GitHub 仓库',
    action: '双轨初始化：新项目填写架构表单，存量项目拉取高频 core/ 基底目录并生成隐式规范。',
    output: '仪表盘提示“已为您生成当前项目的 AI 审查规范，请确认或微调”。',
  },
  {
    stage: '审查期',
    trigger: '开发者提交 Pull Request',
    action: '多路并发分析：拦截层匹配硬规则，意图层对比 Issue 与 Diff，架构层用 RAG 检索存量代码。',
    output: 'GitHub CI/CD 状态显示 Running，目标 30 秒内完成首轮结果。',
  },
  {
    stage: '反馈期',
    trigger: '分析完成',
    action: '生成健康度评分、核心风险点 Blocker，并把低风险建议收敛为 Checklist。',
    output: 'PR 首页自动回复《变更验收报告》，高危风险进入合并拦截。',
  },
]

const analysisLanes = [
  ['拦截层', '硬性规则', '权限绕过、危险 API、配置违规、测试缺口等确定性信号。'],
  ['意图层', 'Issue 对齐', '比较需求描述、PR 标题和 Code Diff，判断是否偏离业务意图。'],
  ['架构层', 'RAG 审查', '召回历史代码切片和隐式规范，识别设计模式偏离与边界破坏。'],
]

const analysisProgress = [
  ['Webhook 接收', '获取 PR Diff、Issue、作者、标签和 CI 状态。'],
  ['拦截层扫描', '执行硬性规则，优先发现权限、租户、SQL、测试缺口。'],
  ['意图层对齐', '比较 Issue 目标、PR 标题和 Diff 行为是否一致。'],
  ['架构层召回', '从隐式规范和历史代码切片中召回设计模式。'],
  ['报告发布', '生成变更验收报告、Blocker 和 Checklist。'],
]

const intentSignals = [
  {
    label: 'Issue 目标',
    value: '提升保护分支合并性能，同时不降低权限校验强度。',
    status: '匹配',
  },
  {
    label: 'Diff 行为',
    value: '新增缓存命中快速返回路径，但权限校验被移动到返回之后。',
    status: '偏离',
  },
  {
    label: '结论',
    value: '性能优化目标成立，但实现方式与“不可绕过保护分支”的需求约束冲突。',
    status: '需处理',
  },
]

const ragMatches = [
  {
    file: 'core/security/branch-policy.ts',
    rule: '保护分支校验必须先于缓存、合并状态和外部检查结果。',
    similarity: 92,
  },
  {
    file: 'service/review-query.ts',
    rule: '所有组织级数据查询必须显式携带 orgId，并在 repository 测试中断言隔离。',
    similarity: 88,
  },
  {
    file: '.ai-reviewer.yml',
    rule: 'auth、tenant、billing、release 路径出现 P0/P1 风险时默认进入合并拦截。',
    similarity: 85,
  },
]

const architectureModules = [
  ['接入层 Webhook & API', '监听 GitHub pull_request 事件，获取 Diff、PR 元数据、Issue 描述、CI 状态和作者信息。'],
  ['上下文引擎 Context Engine', '读取 .ai-reviewer.yml、依赖配置、完整文件、调用链和测试文件，组织模型可用上下文。'],
  ['向量检索库 Vector DB', '存储初始化阶段生成的隐式规范、优秀历史代码切片和团队最佳实践，用于在线 RAG 召回。'],
  ['模型路由大脑 Multi-Agent Router', '简单总结和意图对比走 GPT-4o-mini / Claude Haiku，深度架构与安全推演走 GPT-4o / Claude Sonnet。'],
]

const defaultReviewConfig = {
  projectType: 'monorepo',
  criticalPaths: 'core, api, service, domain',
  blockers: 'auth_bypass, tenant_leak, unsafe_sql',
  testPolicy: 'require_changed_path_coverage',
}

function listToYamlArray(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ')
}

function buildConfigPreview(config) {
  return [
    `project_type: ${config.projectType}`,
    `critical_paths: [${listToYamlArray(config.criticalPaths)}]`,
    `blockers: [${listToYamlArray(config.blockers)}]`,
    `test_policy: ${config.testPolicy}`,
  ]
}

function parseGitHubPullUrl(url) {
  const match = url.trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i)

  if (!match) {
    throw new Error('请输入 GitHub PR 链接，例如 https://github.com/owner/repo/pull/123。')
  }

  return {
    owner: match[1],
    repo: match[2],
    number: match[3],
  }
}

async function fetchGitHubPullRequest(url) {
  const { owner, repo, number } = parseGitHubPullUrl(url)
  const headers = { Accept: 'application/vnd.github+json' }
  const [prResponse, filesResponse] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`, { headers }),
  ])

  if (!prResponse.ok || !filesResponse.ok) {
    throw new Error('GitHub 暂时无法返回该 PR。公开 PR 可直接分析；私有仓库需要下一版接入 GitHub App Token。')
  }

  const [pr, files] = await Promise.all([prResponse.json(), filesResponse.json()])
  return buildReviewFromGitHub({ owner, repo, pr, files })
}

function buildReviewFromGitHub({ owner, repo, pr, files }) {
  const changedLines = files.reduce((total, file) => total + file.additions + file.deletions, 0)
  const findings = analyzeFiles(files)
  const fallbackFinding = {
    id: 'clean-review',
    severity: 'P2',
    file: files[0]?.filename ?? 'pull-request',
    line: 1,
    title: 'MVP 规则未发现阻断级风险',
    confidence: 68,
    owner: '代码产物',
    lane: '反馈层',
    impact: '当前本地分析器没有识别到 P0/P1 风险，但合并前仍建议运行深度模型评审和项目测试。',
    evidence: '规则已扫描权限、租户隔离、注入、危险 DOM、Prompt 循环和缺少测试等信号。',
    suggestion: '合并前运行强推理模型 Review，并确认项目测试或 CI 已覆盖核心路径。',
  }
  const activeFindings = findings.length > 0 ? findings : [fallbackFinding]
  const firstPatchFile = files.find((file) => file.patch) ?? files[0]

  return {
    source: 'GitHub 公开 API',
    status: 'ready',
    summaryStatus: '可交给评审人',
    ciStatus: '30 秒内完成',
    reportTitle: '变更验收报告',
    healthScore: calculateHealthScore(activeFindings, files),
    pr: {
      title: pr.title,
      number: pr.number,
      repo: `${owner}/${repo}`,
      author: pr.user?.login ?? 'unknown',
      branch: pr.head?.ref ?? 'head',
      base: pr.base?.ref ?? 'base',
      additions: pr.additions,
      deletions: pr.deletions,
    },
    metrics: {
      files: files.length,
      changedLines: compactNumber(changedLines),
      highRiskPaths: activeFindings.filter((finding) => severityRank[finding.severity] >= severityRank.P1).length,
      testsMissing: estimateMissingTests(files),
    },
    summary: createSummary(pr, files, activeFindings),
    findings: activeFindings,
    checklist: createChecklist(activeFindings, files),
    diffRows: patchToRows(firstPatchFile?.patch, firstPatchFile?.filename),
  }
}

function analyzeFiles(files) {
  const findings = []
  const hasTestFile = files.some((candidate) => candidate.filename.toLowerCase().includes('test'))

  files.forEach((file, fileIndex) => {
    const patch = file.patch ?? ''
    const added = patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n')
    const removed = patch
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'))
      .join('\n')
    const lowerName = file.filename.toLowerCase()
    const line = firstAddedLineNumber(patch)

    if (/auth|permission|role|policy|token|session/.test(lowerName) && /return|cache|skip|bypass|allow/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P0', line, '权限敏感路径发生变更', 91, '代码产物', '拦截层', '权限或认证相关文件中新增了快速返回、缓存或放行逻辑。', '安全敏感代码的小顺序调整也可能绕过策略校验，需要深度评审。', '补充明确的授权测试，并确认任何快速路径之前都已执行权限校验。'))
    }

    if (/(tenant|orgId|workspaceId|accountId)/i.test(removed) && !/(tenant|orgId|workspaceId|accountId)/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, '租户或组织隔离条件可能被移除', 88, '人类负责人', '架构层', '删除行里出现租户隔离字段，但新增行没有对应约束。', '多租户数据路径丢失过滤条件时，容易造成跨组织数据泄露。', '恢复隔离条件，或补充说明为什么该路径不再需要租户约束。'))
    }

    if (/(query|sql|execute|raw)/i.test(added) && /`|\$\{|concat\(/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, '可能存在动态 SQL 或查询拼接', 84, '代码产物', '拦截层', '新增代码疑似使用插值或拼接构造查询。', '动态查询如果没有参数绑定，可能引入注入风险。', '改为参数化查询，并增加恶意输入用例。'))
    }

    if (/dangerouslySetInnerHTML|innerHTML|eval\(|Function\(/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, '出现危险 DOM 或运行时代码执行', 86, '代码产物', '拦截层', '新增代码包含 HTML 注入或运行时代码执行 API。', '这些 API 风险较高，通常需要输入净化或更安全的渲染方式。', '改用安全渲染方式，或在边界处净化输入并说明可信来源。'))
    }

    if (/prompt|agent|ai|reviewer|system/i.test(lowerName) && /fix|retry|loop|again|agent/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, 'Agent 指令可能导致自动修复循环', 82, 'AI Agent 轨迹', '意图层', 'Prompt 或 Agent 工作流文件中新增了修复、重试或循环相关指令。', 'AI 生成代码的流程风险在于重复产出弱补丁，却没有失败解释和停止条件。', '要求 Agent 引用证据、说明测试，并在一次失败重试后停止自动改写。'))
    }

    if (!lowerName.includes('test') && !hasTestFile) {
      findings.push(makeFinding(file, fileIndex, 'P2', line, '未检测到相邻测试变更', 72, '代码产物', '反馈层', 'PR 修改了生产代码，但前 100 个文件中未出现 test 类文件。', '这不一定是错误，但会增加 Review 和回归验证成本。', '要求作者或编码 Agent 补充聚焦测试，或说明已有覆盖为什么足够。'))
    }
  })

  return dedupeFindings(findings).slice(0, 8)
}

function makeFinding(file, fileIndex, severity, line, title, confidence, owner, lane, evidence, impact, suggestion) {
  return {
    id: `${fileIndex}-${severity}-${title}`,
    severity,
    file: file.filename,
    line,
    title,
    confidence,
    owner,
    lane,
    impact,
    evidence,
    suggestion,
  }
}

function dedupeFindings(findings) {
  const seen = new Set()
  return findings.filter((finding) => {
    const key = `${finding.file}-${finding.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function firstAddedLineNumber(patch) {
  const hunk = patch?.match(/@@ -\d+(?:,\d+)? \+(\d+)/)
  return hunk ? Number(hunk[1]) : 1
}

function patchToRows(patch, filename = '无可用 Patch') {
  if (!patch) {
    return [{ type: 'context', old: '1', next: '1', code: `${filename} 未返回可展示的行级 Patch` }]
  }

  const rows = []
  let oldLine = 0
  let nextLine = 0

  patch.split('\n').forEach((line) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)

    if (hunk) {
      oldLine = Number(hunk[1])
      nextLine = Number(hunk[2])
      rows.push({ type: 'context', old: '', next: '', code: line })
      return
    }

    if (line.startsWith('+')) {
      rows.push({ type: 'added', old: '', next: String(nextLine), code: line.slice(1) })
      nextLine += 1
      return
    }

    if (line.startsWith('-')) {
      rows.push({ type: 'removed', old: String(oldLine), next: '', code: line.slice(1) })
      oldLine += 1
      return
    }

    rows.push({ type: 'context', old: String(oldLine), next: String(nextLine), code: line.startsWith(' ') ? line.slice(1) : line })
    oldLine += 1
    nextLine += 1
  })

  return rows.slice(0, 18)
}

function createSummary(pr, files, findings) {
  const riskyFiles = findings
    .filter((finding) => severityRank[finding.severity] >= severityRank.P1)
    .map((finding) => finding.file)
    .slice(0, 3)
  const riskText = riskyFiles.length > 0 ? `风险重点：${riskyFiles.join('、')}。` : 'MVP 规则未发现阻断级风险。'
  const testText = files.some((file) => file.filename.toLowerCase().includes('test'))
    ? '该 PR 包含测试文件变更，评审人应确认测试是否覆盖高风险路径。'
    : '未在拉取到的文件列表中检测到测试文件，QA 需要明确回归范围。'

  return `${pr.title}。该 PR 修改 ${files.length} 个文件，触及 ${compactNumber(pr.additions + pr.deletions)} 行。${riskText}${testText}`
}

function createChecklist(findings, files) {
  const items = findings
    .filter((finding) => finding.severity !== 'P0')
    .slice(0, 3)
    .map((finding) => finding.suggestion)

  if (!files.some((file) => file.filename.toLowerCase().includes('test'))) {
    items.push('补充测试覆盖说明，明确为何当前 PR 可以安全合并。')
  }

  return items.slice(0, 4)
}

function calculateHealthScore(findings, files) {
  const penalty = findings.reduce((score, finding) => {
    if (finding.severity === 'P0') return score + 22
    if (finding.severity === 'P1') return score + 10
    return score + 4
  }, 0)
  const testPenalty = files.some((file) => file.filename.toLowerCase().includes('test')) ? 0 : 6
  return Math.max(42, 100 - penalty - testPenalty)
}

function estimateMissingTests(files) {
  const productionFiles = files.filter((file) => !file.filename.toLowerCase().includes('test')).length
  const testFiles = files.filter((file) => file.filename.toLowerCase().includes('test')).length

  return Math.max(0, Math.min(4, Math.ceil(productionFiles / 6) - testFiles))
}

function compactNumber(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.0', '')}k`
  return String(value)
}

function statusLabel(status) {
  const labels = {
    ready: '已接入',
    demo: '演示',
    planned: '规划中',
    partial: '部分',
  }

  return labels[status] ?? status
}

function contextSources(review) {
  return [
    ['Git Diff', `${review.metrics.changedLines} 行变更`, 'ready'],
    ['完整文件', `${review.metrics.files} 个相关文件`, review.source.includes('GitHub') ? 'ready' : 'demo'],
    ['.ai-reviewer.yml', '硬性规则、目录边界、测试策略', 'planned'],
    ['需求上下文', `Issue / PR #${review.pr.number}`, review.source.includes('GitHub') ? 'partial' : 'demo'],
    ['隐式规范', 'core/、api/、service/ 历史代码切片', 'planned'],
  ]
}

function App() {
  const [prUrl, setPrUrl] = useState(samplePrUrl)
  const [review, setReview] = useState(sampleReview)
  const [statusMessage, setStatusMessage] = useState('已加载演示 PR。你也可以粘贴公开 GitHub PR 链接，系统会拉取元数据和文件 Patch 进行分析。')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [activeFindingId, setActiveFindingId] = useState(sampleReview.findings[0].id)
  const [activeView, setActiveView] = useState(views[0])
  const [projectMode, setProjectMode] = useState('existing')
  const [reviewConfig, setReviewConfig] = useState(defaultReviewConfig)
  const [minSeverity, setMinSeverity] = useState('P1')
  const [confidence, setConfidence] = useState(80)
  const [feedback, setFeedback] = useState('useful')
  const [progressStep, setProgressStep] = useState(analysisProgress.length - 1)

  const visibleFindings = useMemo(() => {
    return review.findings.filter(
      (finding) =>
        severityRank[finding.severity] >= severityRank[minSeverity] &&
        finding.confidence >= confidence,
    )
  }, [confidence, minSeverity, review.findings])

  const selectedFinding = useMemo(() => {
    return (
      visibleFindings.find((finding) => finding.id === activeFindingId) ??
      visibleFindings[0] ??
      review.findings.find((finding) => finding.id === activeFindingId) ??
      review.findings[0]
    )
  }, [activeFindingId, review.findings, visibleFindings])

  const visibleHighRisks = visibleFindings.filter((finding) => severityRank[finding.severity] >= severityRank.P1).length
  const blockerCount = review.findings.filter((finding) => finding.severity === 'P0').length
  const selectedMode = onboardingModes[projectMode]
  const configPreview = buildConfigPreview(reviewConfig)
  const blockerRules = listToYamlArray(reviewConfig.blockers)

  function updateReviewConfig(field, value) {
    setReviewConfig((current) => ({ ...current, [field]: value }))
  }

  async function runAnalysis() {
    setIsAnalyzing(true)
    setProgressStep(0)
    setStatusMessage('正在从 GitHub 获取 PR 元数据、变更文件和 Patch，并启动三路并发分析...')

    try {
      analysisProgress.forEach((_, index) => {
        window.setTimeout(() => {
          setProgressStep(index)
        }, index * 260)
      })
      const liveReview = await fetchGitHubPullRequest(prUrl)
      setReview(liveReview)
      setActiveFindingId(liveReview.findings[0].id)
      setActiveView('评审工作台')
      setProgressStep(analysisProgress.length - 1)
      setStatusMessage('已完成公开 PR 分析。私有仓库、企业规范和内部文档会在 GitHub App 版本中接入。')
    } catch (error) {
      setReview({
        ...sampleReview,
        status: 'fallback',
        summaryStatus: '演示样例生效',
      })
      setActiveFindingId(sampleReview.findings[0].id)
      setActiveView('评审工作台')
      setProgressStep(analysisProgress.length - 1)
      setStatusMessage(`${error.message} 当前回退到内置演示 PR，保证评审流程可继续体验。`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="产品导航">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <strong>CodeSentinel</strong>
            <span>AI 架构师 V1.0</span>
          </div>
        </div>

        <nav>
          {views.map((item) => (
            <button
              className={activeView === item ? 'nav-item active' : 'nav-item'}
              key={item}
              type="button"
              onClick={() => setActiveView(item)}
            >
              <span>{item}</span>
              {item === '评审工作台' && <b>{visibleHighRisks}</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span>商业化基线</span>
          <strong>三路并发审查</strong>
          <p>当前 Blocker：{blockerRules || '未配置'}。高危风险进入合并拦截，低风险建议收敛到 Checklist。</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">AI 辅助 Pull Request Review</span>
            <h1>AI 架构师 V1.0：先接入规范，再审查变更。</h1>
          </div>
          <form
            className="pr-input"
            onSubmit={(event) => {
              event.preventDefault()
              runAnalysis()
            }}
          >
            <label htmlFor="pr-url">GitHub PR 链接</label>
            <div className="input-row">
              <input
                id="pr-url"
                value={prUrl}
                onChange={(event) => setPrUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
              />
              <button className="primary-button" type="submit" disabled={isAnalyzing}>
                {isAnalyzing ? '分析中...' : '开始分析'}
              </button>
            </div>
          </form>
        </header>

        <div className={`status-banner ${review.status === 'fallback' ? 'warning' : ''}`}>
          <b>{review.source}</b>
          <span>{statusMessage}</span>
        </div>

        {activeView === '接入配置' && (
          <section className="onboarding-view">
            <article className="flow-panel">
              <div className="section-heading">
                <span>核心业务流</span>
                <strong>接入期 / 审查期 / 反馈期</strong>
              </div>
              <div className="flow-grid">
                {businessFlow.map((item) => (
                  <div className="flow-card" key={item.stage}>
                    <b>{item.stage}</b>
                    <p><strong>触发：</strong>{item.trigger}</p>
                    <p><strong>后台：</strong>{item.action}</p>
                    <p><strong>呈现：</strong>{item.output}</p>
                  </div>
                ))}
              </div>
            </article>

            <section className="setup-grid">
              <article className="setup-panel">
                <div className="section-heading">
                  <span>仓库初始化</span>
                  <strong>{selectedMode.status}</strong>
                </div>
                <div className="mode-switch" aria-label="项目类型">
                  {Object.entries(onboardingModes).map(([key, mode]) => (
                    <button
                      className={projectMode === key ? 'active' : ''}
                      key={key}
                      type="button"
                      onClick={() => setProjectMode(key)}
                    >
                      {mode.title}
                    </button>
                  ))}
                </div>
                <h2>{selectedMode.title}</h2>
                <p>{selectedMode.description}</p>
                <div className="setup-form" aria-label="架构表单预览">
                  <label>
                    项目类型
                    <select value={reviewConfig.projectType} onChange={(event) => updateReviewConfig('projectType', event.target.value)}>
                      <option value="monorepo">monorepo</option>
                      <option value="service">service</option>
                      <option value="frontend">frontend</option>
                      <option value="library">library</option>
                    </select>
                  </label>
                  <label>
                    核心目录
                    <input
                      value={reviewConfig.criticalPaths}
                      onChange={(event) => updateReviewConfig('criticalPaths', event.target.value)}
                    />
                  </label>
                  <label>
                    硬性拦截规则
                    <input
                      value={reviewConfig.blockers}
                      onChange={(event) => updateReviewConfig('blockers', event.target.value)}
                    />
                  </label>
                  <label>
                    测试策略
                    <input
                      value={reviewConfig.testPolicy}
                      onChange={(event) => updateReviewConfig('testPolicy', event.target.value)}
                    />
                  </label>
                </div>
              </article>

              <article className="config-panel">
                <div className="section-heading">
                  <span>生成结果</span>
                  <strong>AI 审查规范</strong>
                </div>
                <p>已为当前项目生成 AI 审查规范，请确认或微调后启用。</p>
                <pre>{configPreview.join('\n')}</pre>
                <div className="config-impact">
                  <span>策略影响</span>
                  <p>拦截层会优先扫描 {blockerRules || '未配置规则'}；架构层会围绕 {listToYamlArray(reviewConfig.criticalPaths) || '未配置目录'} 建立隐式规范。</p>
                </div>
                <button className="primary-button" type="button" onClick={() => setActiveView('评审工作台')}>
                  确认并进入审查
                </button>
              </article>
            </section>
          </section>
        )}

        {activeView === '评审工作台' && (
          <>
            <section className="summary-panel report-panel">
              <div className="summary-copy">
                <div className="section-heading">
                  <span>{review.reportTitle}</span>
                  <strong>{isAnalyzing ? 'Running...' : review.ciStatus}</strong>
                </div>
                <h2>{review.pr.title}</h2>
                <p>{review.summary}</p>
                <div className="pr-meta">
                  <span>{review.pr.repo}</span>
                  <span>#{review.pr.number}</span>
                  <span>{review.pr.branch} 合入 {review.pr.base}</span>
                  <span>提交人 {review.pr.author}</span>
                </div>
              </div>

              <div className="score-card" aria-label="健康度评分">
                <span>健康度评分</span>
                <strong>{review.healthScore}</strong>
                <p>{blockerCount > 0 ? `${blockerCount} 个 Blocker，建议拦截合并` : '未发现阻断风险，可进入人工确认'}</p>
              </div>
            </section>

            <section className="lane-grid" aria-label="多路并发分析">
              {analysisLanes.map(([name, type, detail]) => (
                <div className="lane-card" key={name}>
                  <span>{name}</span>
                  <b>{type}</b>
                  <p>{detail}</p>
                </div>
              ))}
            </section>

            <section className="progress-panel" aria-label="分析进度">
              <div className="section-heading">
                <span>GitHub CI/CD 状态</span>
                <strong>{isAnalyzing ? 'Running...' : review.ciStatus}</strong>
              </div>
              <div className="progress-steps">
                {analysisProgress.map(([title, detail], index) => {
                  const state = index < progressStep ? 'done' : index === progressStep ? 'active' : 'pending'

                  return (
                    <div className={`progress-step ${state}`} key={title}>
                      <b>{title}</b>
                      <p>{detail}</p>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="evidence-grid" aria-label="意图与架构证据">
              <article className="intent-panel">
                <div className="section-heading">
                  <span>意图层分析</span>
                  <strong>Issue vs Diff</strong>
                </div>
                <div className="signal-list">
                  {intentSignals.map((signal) => (
                    <div className="signal-row" key={signal.label}>
                      <span>{signal.label}</span>
                      <p>{signal.value}</p>
                      <em>{signal.status}</em>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rag-panel">
                <div className="section-heading">
                  <span>架构层 RAG</span>
                  <strong>隐式规范召回</strong>
                </div>
                <div className="rag-list">
                  {ragMatches.map((match) => (
                    <div className="rag-row" key={match.file}>
                      <b>{match.file}</b>
                      <p>{match.rule}</p>
                      <span>{match.similarity}% 相似</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="acceptance-report" aria-label="PR 首页自动回复">
              <article className="blocker-card">
                <div className="section-heading">
                  <span>合并闸口</span>
                  <strong>{blockerCount > 0 ? '阻断合并' : '人工确认'}</strong>
                </div>
                <h2>{blockerCount > 0 ? '发现核心风险点 Blocker' : '未发现阻断级风险'}</h2>
                <p>
                  {blockerCount > 0
                    ? '系统会在 PR 首页回复验收报告，并把 P0 风险标记为必须处理项。合并按钮应保持拦截，直到风险被修复或负责人确认豁免。'
                    : '当前没有 P0 风险，低风险建议会作为 Checklist 交给作者和评审人确认。'}
                </p>
                <div className="blocker-list">
                  {review.findings
                    .filter((finding) => finding.severity === 'P0')
                    .map((finding) => (
                      <div key={finding.id}>
                        <span className="severity p0">P0</span>
                        <b>{finding.title}</b>
                        <em>{finding.file}:{finding.line}</em>
                      </div>
                    ))}
                </div>
              </article>

              <article className="checklist-card">
                <div className="section-heading">
                  <span>低风险建议</span>
                  <strong>Checklist</strong>
                </div>
                <ul>
                  {review.checklist.map((item) => (
                    <li key={item}>
                      <input type="checkbox" readOnly />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </section>

            <section className="review-grid">
              <article className="findings-panel">
                <div className="section-heading">
                  <span>核心风险点</span>
                  <strong>{visibleFindings.length} 条</strong>
                </div>
                <div className="filters" aria-label="降噪控制">
                  <label>
                    最低级别
                    <select value={minSeverity} onChange={(event) => setMinSeverity(event.target.value)}>
                      <option>P0</option>
                      <option>P1</option>
                      <option>P2</option>
                    </select>
                  </label>
                  <label>
                    置信度 {confidence}%
                    <input
                      min="60"
                      max="95"
                      step="5"
                      type="range"
                      value={confidence}
                      onChange={(event) => setConfidence(Number(event.target.value))}
                    />
                  </label>
                </div>
                <div className="findings-list">
                  {visibleFindings.length === 0 && (
                    <div className="empty-state">当前降噪条件下没有可见风险项。</div>
                  )}
                  {visibleFindings.map((finding) => (
                    <button
                      className={selectedFinding.id === finding.id ? 'finding-card active' : 'finding-card'}
                      key={finding.id}
                      type="button"
                      onClick={() => setActiveFindingId(finding.id)}
                    >
                      <span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity}</span>
                      <span className="finding-title">{finding.title}</span>
                      <span>{finding.file}:{finding.line}</span>
                      <b>{finding.confidence}%</b>
                    </button>
                  ))}
                </div>
              </article>

              <article className="diff-panel">
                <div className="section-heading">
                  <span>行级 Review</span>
                  <strong>{selectedFinding.file}:{selectedFinding.line}</strong>
                </div>
                <div className="diff-viewer" aria-label="代码 Diff 视图">
                  {review.diffRows.map((row, index) => (
                    <div className={`diff-row ${row.type}`} key={`${index}-${row.old}-${row.next}-${row.code}`}>
                      <span>{row.old}</span>
                      <span>{row.next}</span>
                      <code>{row.code}</code>
                    </div>
                  ))}
                </div>
                <div className="inline-comment">
                  <div className="comment-header">
                    <span className={`severity ${selectedFinding.severity.toLowerCase()}`}>{selectedFinding.severity}</span>
                    <strong>{selectedFinding.title}</strong>
                    <em>{selectedFinding.lane} · {selectedFinding.owner}</em>
                  </div>
                  <p>{selectedFinding.impact}</p>
                  <p><b>证据：</b>{selectedFinding.evidence}</p>
                  <div className="suggestion-block">
                    <span>修改建议</span>
                    <code>{selectedFinding.suggestion}</code>
                  </div>
                  <div className="comment-actions">
                    <button type="button">采纳建议</button>
                    <button
                      className={feedback === 'useful' ? 'active' : ''}
                      type="button"
                      onClick={() => setFeedback('useful')}
                    >
                      有帮助
                    </button>
                    <button
                      className={feedback === 'noisy' ? 'active' : ''}
                      type="button"
                      onClick={() => setFeedback('noisy')}
                    >
                      太打扰
                    </button>
                  </div>
                </div>
              </article>
            </section>
          </>
        )}

        {activeView === '系统设计' && (
          <section className="secondary-view">
            <article className="context-panel">
              <div className="section-heading">
                <span>上下文管线</span>
                <strong>5 类来源</strong>
              </div>
              <div className="source-list">
                {contextSources(review).map(([name, detail, status]) => (
                  <div className="source-row" key={name}>
                    <span>{name}</span>
                    <b>{detail}</b>
                    <em className={status}>{statusLabel(status)}</em>
                  </div>
                ))}
              </div>
            </article>

            <article className="decision-panel architecture-panel">
              <div className="section-heading">
                <span>系统架构拆解</span>
                <strong>V1.0 商业化基线</strong>
              </div>
              {architectureModules.map(([title, detail]) => (
                <div className="decision-row" key={title}>
                  <b>{title}</b>
                  <p>{detail}</p>
                </div>
              ))}
            </article>
          </section>
        )}

        {activeView === '团队洞察' && (
          <section className="secondary-view compact">
            <article className="decision-panel">
              <div className="section-heading">
                <span>评审对象</span>
                <strong>AI 时代的责任边界</strong>
              </div>
              <div className="target-list">
                <div>
                  <b>代码产物</b>
                  <p>这次 Diff 是否破坏正确性、安全性、可维护性和可测试性。</p>
                </div>
                <div>
                  <b>AI Agent 轨迹</b>
                  <p>生成过程是否出现浅层修复、循环改写、缺少证据或没有测试假设。</p>
                </div>
                <div>
                  <b>人类负责人</b>
                  <p>谁来确认业务意图、风险取舍和上线责任。</p>
                </div>
              </div>
            </article>

            <article className="roadmap-panel">
              <div className="section-heading">
                <span>未来扩展</span>
                <strong>从 PR 后移到研发全流程</strong>
              </div>
              <ul>
                <li>IDE 预审：在 VS Code 或 JetBrains 中提前发现问题。</li>
                <li>自动修复分支：系统创建修复分支并运行单元测试。</li>
                <li>团队反馈校准：根据采纳、拒绝和忽略行为优化建议质量。</li>
                <li>研发质量看板：沉淀常见风险类型、Review 耗时和质量趋势。</li>
              </ul>
            </article>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
