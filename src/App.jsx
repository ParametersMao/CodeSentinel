import { useMemo, useState } from 'react'
import './App.css'

const samplePrUrl = 'https://github.com/acme/codesentinel/pull/421'

const sampleReview = {
  source: '演示样例',
  status: 'ready',
  summaryStatus: '可交给评审人',
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
    '这个 PR 为合并决策增加缓存、更新开发者 Agent 使用的 Review Prompt，并调整了评审摘要卡片。主要风险集中在权限校验顺序和租户隔离数据查询。QA 建议重点覆盖保护分支拒绝合并、缓存失效场景和组织数据隔离。',
  findings: [
    {
      id: 'auth-bypass',
      severity: 'P0',
      file: 'src/api/merge.ts',
      line: 88,
      title: '合并权限校验可能被绕过',
      confidence: 94,
      owner: '代码产物',
      impact: '当分支规则缓存命中时，拥有普通写权限的用户可能绕过保护分支校验并完成合并。',
      evidence: '新增的快速返回路径发生在 validateBranchProtection 之前。',
      suggestion: '把 validateBranchProtection 前置到缓存返回之前，并补充缓存命中场景的回归测试。',
    },
    {
      id: 'tenant-leak',
      severity: 'P1',
      file: 'src/db/reviews.ts',
      line: 143,
      title: 'Review 查询可能丢失租户过滤',
      confidence: 89,
      owner: '人类负责人',
      impact: '企业客户可能在评审看板中看到其他组织的 Review 元数据。',
      evidence: '旧逻辑里的 orgId 条件被删除，但底层仍然使用共享 reviews 表。',
      suggestion: '恢复 orgId 查询条件，并在 repository 测试夹具中加入组织隔离断言。',
    },
    {
      id: 'ai-loop',
      severity: 'P1',
      file: 'prompts/reviewer.md',
      line: 36,
      title: '自动修复 Prompt 可能导致循环改代码',
      confidence: 82,
      owner: 'AI Agent 轨迹',
      impact: '开发者 Agent 可能反复重写同一段代码，却没有说明失败原因和取舍。',
      evidence: 'Prompt 要求修复问题，但没有要求引用失败检查、解释补丁或设置停止条件。',
      suggestion: '要求 Agent 引用失败检查、解释修改原因，并在一次重试仍失败后停止自动改写。',
    },
    {
      id: 'summary-noise',
      severity: 'P2',
      file: 'src/components/SummaryCard.jsx',
      line: 22,
      title: 'PR 摘要缺少测试范围建议',
      confidence: 71,
      owner: '代码产物',
      impact: 'QA 可以看到变更摘要，但无法快速判断需要重点回归哪些路径。',
      evidence: '当前摘要只描述功能和文件，没有说明测试面。',
      suggestion: '根据变更路由和 API 追加一段测试范围建议。',
    },
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

const pipelineSteps = [
  ['获取', '通过 GitHub App 或公开 API 获取 PR Diff、完整文件、检查状态、标签和作者信息。'],
  ['理解', '补充调用链、依赖配置、测试文件、需求描述和团队代码规范。'],
  ['路由', '摘要走快速低成本模型，高风险代码走强推理模型。'],
  ['降噪', '用置信度、严重级别、重复聚类和责任归因压低无效评论。'],
  ['发布', '异步写入 PR 摘要、行级评论、侧边报告和反馈事件。'],
]

const severityRank = { P0: 3, P1: 2, P2: 1 }

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
    throw new Error('GitHub 暂时无法返回该 PR。公开 PR 可直接分析；私有仓库需要在下一版接入 GitHub App Token。')
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
    diffRows: patchToRows(firstPatchFile?.patch, firstPatchFile?.filename),
  }
}

function analyzeFiles(files) {
  const findings = []

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
      findings.push(makeFinding(file, fileIndex, 'P0', line, '权限敏感路径发生变更', 91, '代码产物', '权限或认证相关文件中新增了快速返回、缓存或放行逻辑。', '安全敏感代码的小顺序调整也可能绕过策略校验，需要深度评审。', '要求补充明确的授权测试，并确认任何快速路径之前都已执行权限校验。'))
    }

    if (/(tenant|orgId|workspaceId|accountId)/i.test(removed) && !/(tenant|orgId|workspaceId|accountId)/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, '租户或组织隔离条件可能被移除', 88, '人类负责人', '删除行里出现租户隔离字段，但新增行没有对应约束。', '多租户数据路径丢失过滤条件时，容易造成跨组织数据泄露。', '恢复隔离条件，或补充说明为什么该路径不再需要租户约束。'))
    }

    if (/(query|sql|execute|raw)/i.test(added) && /`|\$\{|concat\(/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, '可能存在动态 SQL 或查询拼接', 84, '代码产物', '新增代码疑似使用插值或拼接构造查询。', '动态查询如果没有参数绑定，可能引入注入风险。', '改为参数化查询，并增加恶意输入用例。'))
    }

    if (/dangerouslySetInnerHTML|innerHTML|eval\(|Function\(/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, '出现危险 DOM 或运行时代码执行', 86, '代码产物', '新增代码包含 HTML 注入或运行时代码执行 API。', '这些 API 风险较高，通常需要输入净化或更安全的渲染方式。', '改用安全渲染方式，或在边界处净化输入并说明可信来源。'))
    }

    if (/prompt|agent|ai|reviewer|system/i.test(lowerName) && /fix|retry|loop|again|agent/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, 'Agent 指令可能导致自动修复循环', 82, 'AI Agent 轨迹', 'Prompt 或 Agent 工作流文件中新增了修复、重试或循环相关指令。', 'AI 生成代码的流程风险在于重复产出弱补丁，却没有失败解释和停止条件。', '要求 Agent 引用证据、说明测试，并在一次失败重试后停止自动改写。'))
    }

    if (!lowerName.includes('test') && !files.some((candidate) => candidate.filename.toLowerCase().includes('test'))) {
      findings.push(makeFinding(file, fileIndex, 'P2', line, '未检测到相邻测试变更', 72, '代码产物', 'PR 修改了生产代码，但前 100 个文件中未出现 test 类文件。', '这不一定是错误，但会增加 Review 和回归验证成本。', '要求作者或编码 Agent 补充聚焦测试，或说明已有覆盖为什么足够。'))
    }
  })

  return dedupeFindings(findings).slice(0, 8)
}

function makeFinding(file, fileIndex, severity, line, title, confidence, owner, evidence, impact, suggestion) {
  return {
    id: `${fileIndex}-${severity}-${title}`,
    severity,
    file: file.filename,
    line,
    title,
    confidence,
    owner,
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
    ? '本 PR 包含测试文件变更，评审人应确认测试是否覆盖高风险路径。'
    : '未在拉取到的文件列表中检测到测试文件，QA 需要明确回归范围。'

  return `${pr.title}。该 PR 修改 ${files.length} 个文件，触及 ${compactNumber(pr.additions + pr.deletions)} 行。${riskText}${testText}`
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

function contextSources(review) {
  return [
    ['Git Diff', `${review.metrics.changedLines} 行变更`, 'ready'],
    ['完整文件', `${review.metrics.files} 个相关文件`, review.source.includes('GitHub') ? 'ready' : 'demo'],
    ['依赖配置', 'package.json、lockfile', 'planned'],
    ['需求上下文', `PR #${review.pr.number}、标签`, review.source.includes('GitHub') ? 'partial' : 'demo'],
    ['团队规范', '安全 Review 策略', 'ready'],
  ]
}

function App() {
  const [prUrl, setPrUrl] = useState(samplePrUrl)
  const [review, setReview] = useState(sampleReview)
  const [statusMessage, setStatusMessage] = useState('MVP 已加载演示 PR。你可以粘贴公开 GitHub PR 链接，系统会拉取元数据和文件 Patch 进行分析。')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [activeFindingId, setActiveFindingId] = useState(sampleReview.findings[0].id)
  const [minSeverity, setMinSeverity] = useState('P1')
  const [confidence, setConfidence] = useState(80)
  const [feedback, setFeedback] = useState('useful')

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

  async function runAnalysis() {
    setIsAnalyzing(true)
    setStatusMessage('正在从 GitHub 获取 PR 元数据、变更文件和 Patch...')

    try {
      const liveReview = await fetchGitHubPullRequest(prUrl)
      setReview(liveReview)
      setActiveFindingId(liveReview.findings[0].id)
      setStatusMessage('已完成公开 PR 分析。私有仓库、企业规范和内部文档将在 GitHub App 版本中接入。')
    } catch (error) {
      setReview({
        ...sampleReview,
        status: 'fallback',
        summaryStatus: '演示样例生效',
      })
      setActiveFindingId(sampleReview.findings[0].id)
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
            <span>代码哨兵 AI Review</span>
          </div>
        </div>
        <nav>
          {['评审队列', '风险雷达', '团队规范', '模型路由', '效能洞察'].map((item, index) => (
            <button className={index === 0 ? 'nav-item active' : 'nav-item'} key={item}>
              <span>{item}</span>
              {index === 0 && <b>{review.findings.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>当前策略</span>
          <strong>只主动评论 P0/P1</strong>
          <p>P2 建议默认留在报告里，避免 AI 评论打扰开发者。</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="pr-input">
            <label htmlFor="pr-url">GitHub PR 链接</label>
            <input
              id="pr-url"
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
            />
          </div>
          <button className="primary-button" type="button" onClick={runAnalysis} disabled={isAnalyzing}>
            {isAnalyzing ? '分析中...' : '开始分析'}
          </button>
        </header>

        <div className={`status-banner ${review.status === 'fallback' ? 'warning' : ''}`}>
          <b>{review.source}</b>
          <span>{statusMessage}</span>
        </div>

        <section className="summary-row">
          <article className="summary-panel">
            <div className="section-heading">
              <span>PR 摘要</span>
              <strong>{isAnalyzing ? '正在生成草稿' : review.summaryStatus}</strong>
            </div>
            <h1>{review.pr.title}</h1>
            <p>{review.summary}</p>
            <div className="pr-meta">
              <span>{review.pr.repo}</span>
              <span>#{review.pr.number}</span>
              <span>{review.pr.branch} 合入 {review.pr.base}</span>
              <span>提交人 {review.pr.author}</span>
            </div>
            <div className="summary-metrics">
              <span><strong>{review.metrics.files}</strong> 个文件</span>
              <span><strong>{review.metrics.changedLines}</strong> 行变更</span>
              <span><strong>{review.metrics.highRiskPaths}</strong> 个高风险路径</span>
              <span><strong>{review.metrics.testsMissing}</strong> 个测试缺口</span>
            </div>
          </article>

          <article className="target-panel">
            <div className="section-heading">
              <span>评审对象</span>
              <strong>AI 时代责任边界</strong>
            </div>
            <div className="target-grid">
              <div>
                <b>代码产物</b>
                <p>这次 Diff 是否破坏正确性、安全性和可维护性？</p>
              </div>
              <div>
                <b>AI Agent 轨迹</b>
                <p>生成过程是否出现浅层修复、循环改写或缺少依据？</p>
              </div>
              <div>
                <b>人类负责人</b>
                <p>谁来确认业务意图、风险取舍和上线责任？</p>
              </div>
            </div>
          </article>
        </section>

        <section className="review-grid">
          <article className="findings-panel">
            <div className="section-heading">
              <span>风险发现</span>
              <strong>{visibleFindings.length} 条可见</strong>
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
                <div className="empty-state">
                  当前降噪条件下没有可见风险项。
                </div>
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
                <em>{selectedFinding.owner}</em>
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

          <aside className="context-panel">
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

            <div className="model-box">
              <span>模型路由</span>
              <div>
                <b>快速摘要模型</b>
                <p>MVP 当前使用本地摘要逻辑；生产版本会路由到低成本快速模型。</p>
              </div>
              <div>
                <b>深度风险模型</b>
                <p>强推理模型只分析权限、数据访问、Prompt 和高风险文件，控制成本与延迟。</p>
              </div>
            </div>

            <div className="roadmap-box">
              <span>后续扩展</span>
              <p>IDE 预审、GitHub App 鉴权、私有仓库上下文、自动修复分支和研发质量看板。</p>
            </div>
          </aside>
        </section>

        <section className="architecture-strip">
          {pipelineSteps.map(([title, detail]) => (
            <div key={title}>
              <b>{title}</b>
              <p>{detail}</p>
            </div>
          ))}
        </section>
      </section>
    </main>
  )
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

export default App
