import { useMemo, useState } from 'react'
import './App.css'

const samplePrUrl = 'https://github.com/acme/reviewpilot/pull/421'

const sampleReview = {
  source: 'Demo fallback',
  status: 'ready',
  summaryStatus: 'Ready for reviewers',
  pr: {
    title: 'Protected-branch merge flow and AI review prompt update',
    number: 421,
    repo: 'acme/reviewpilot',
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
    'This PR speeds up merge decisions with a cache, updates the review prompt used by developer agents, and refreshes the dashboard summary card. The risky surface is authorization order and tenant-scoped review data. QA should cover protected-branch merge denial, stale cache behavior, and org isolation.',
  findings: [
    {
      id: 'auth-bypass',
      severity: 'P0',
      file: 'src/api/merge.ts',
      line: 88,
      title: 'Merge permission check can be bypassed',
      confidence: 94,
      owner: 'Code artifact',
      impact: 'A user with write access to any branch can merge protected PRs when the branch rule cache is cold.',
      evidence: 'The new fast path returns before validateBranchProtection runs.',
      suggestion: 'Move validateBranchProtection before the cache hit return and add a regression test for stale rules.',
    },
    {
      id: 'tenant-leak',
      severity: 'P1',
      file: 'src/db/reviews.ts',
      line: 143,
      title: 'Tenant filter dropped from review query',
      confidence: 89,
      owner: 'Human owner',
      impact: 'Enterprise customers may see another organization\'s review metadata in the dashboard.',
      evidence: 'The previous orgId predicate was removed while keeping the shared reviews table.',
      suggestion: 'Restore orgId in the where clause and assert it in the repository test fixture.',
    },
    {
      id: 'ai-loop',
      severity: 'P1',
      file: 'prompts/reviewer.md',
      line: 36,
      title: 'Auto-fix prompt can create a review loop',
      confidence: 82,
      owner: 'AI-agent trace',
      impact: 'The developer agent may repeatedly rewrite the same block without explaining the tradeoff.',
      evidence: 'The prompt asks for fixes but does not require a failing-test hypothesis or stop condition.',
      suggestion: 'Require the agent to cite the failing check, explain the patch, and stop after one unsuccessful retry.',
    },
    {
      id: 'summary-noise',
      severity: 'P2',
      file: 'src/components/SummaryCard.jsx',
      line: 22,
      title: 'Summary omits QA scope',
      confidence: 71,
      owner: 'Code artifact',
      impact: 'QA gets a change summary but not a test surface recommendation.',
      evidence: 'The generated description mentions features and files only.',
      suggestion: 'Append a short test-scope sentence generated from touched routes and changed APIs.',
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
  ['Fetch', 'GitHub App receives PR webhook and pulls diff, full files, checks, labels, author metadata.'],
  ['Understand', 'Retriever adds nearby call sites, dependency manifests, test files, issue text, and team rules.'],
  ['Route', 'Fast model drafts summary; reasoning model inspects high-risk hunks and security-sensitive paths.'],
  ['Filter', 'Confidence, severity, duplicate clustering, and ownership tags suppress low-value comments.'],
  ['Publish', 'GitHub inline comments, PR body summary, side-panel report, and feedback events are written async.'],
]

const severityRank = { P0: 3, P1: 2, P2: 1 }

function parseGitHubPullUrl(url) {
  const match = url.trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i)

  if (!match) {
    throw new Error('Enter a GitHub pull request URL like https://github.com/owner/repo/pull/123.')
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
    throw new Error('GitHub could not return this PR. Public PRs work without setup; private PRs need a GitHub App token in the next iteration.')
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
    title: 'No blocking risk found by MVP rules',
    confidence: 68,
    owner: 'Code artifact',
    impact: 'The MVP analyzer did not identify P0 or P1 risks. A deep model pass is still recommended before merge.',
    evidence: 'Rules scanned added and removed lines for auth, tenant, injection, unsafe DOM, prompt-loop, and missing-test signals.',
    suggestion: 'Run the reasoning model pass and project tests before treating this PR as fully reviewed.',
  }

  const activeFindings = findings.length > 0 ? findings : [fallbackFinding]
  const firstPatchFile = files.find((file) => file.patch) ?? files[0]

  return {
    source: 'GitHub public API',
    status: 'ready',
    summaryStatus: 'Ready for reviewers',
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
      findings.push(makeFinding(file, fileIndex, 'P0', line, 'Permission-sensitive path changed', 91, 'Code artifact', 'Auth or permission code changed near early-return or cache logic.', 'Security-sensitive files need a deep reasoning pass because small ordering changes can bypass policy checks.', 'Require an explicit authorization test and verify policy checks run before any fast path.'))
    }

    if (/(tenant|orgId|workspaceId|accountId)/i.test(removed) && !/(tenant|orgId|workspaceId|accountId)/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, 'Tenant or organization guard may have been removed', 88, 'Human owner', 'A tenant-scoping predicate appears in removed lines but not in added lines.', 'Multi-tenant data paths can leak metadata when scoping filters are lost during refactors.', 'Restore the scoping predicate or add an assertion explaining why this path is no longer tenant-bound.'))
    }

    if (/(query|sql|execute|raw)/i.test(added) && /`|\$\{|concat\(/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, 'Possible dynamic query construction', 84, 'Code artifact', 'Added lines appear to build a query with interpolation or concatenation.', 'Dynamic query assembly can introduce injection risk unless parameters are bound.', 'Use parameterized queries and add a test with hostile input.'))
    }

    if (/dangerouslySetInnerHTML|innerHTML|eval\(|Function\(/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, 'Unsafe runtime execution or DOM injection', 86, 'Code artifact', 'Added lines include direct HTML injection or runtime code execution.', 'These APIs are high-risk and often need sanitization or a safer rendering strategy.', 'Replace with safe rendering or sanitize input at the boundary and document the trusted source.'))
    }

    if (/prompt|agent|ai|reviewer|system/i.test(lowerName) && /fix|retry|loop|again|agent/i.test(added)) {
      findings.push(makeFinding(file, fileIndex, 'P1', line, 'Agent instruction may create an auto-fix loop', 82, 'AI-agent trace', 'Prompt or agent workflow files changed near fix/retry instructions.', 'AI-generated code loops are a process risk: the same weak patch can be regenerated without a stop condition.', 'Require the agent to cite evidence, run or name a test, and stop after one unsuccessful retry.'))
    }

    if (!lowerName.includes('test') && !files.some((candidate) => candidate.filename.toLowerCase().includes('test'))) {
      findings.push(makeFinding(file, fileIndex, 'P2', line, 'No nearby test change detected', 72, 'Code artifact', 'The PR changed production code but no test-like file was included in the first 100 files.', 'This is not always wrong, but it increases reviewer effort and regression risk.', 'Ask the author or their coding agent to add focused tests or state why existing coverage is sufficient.'))
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

function patchToRows(patch, filename = 'No patch available') {
  if (!patch) {
    return [{ type: 'context', old: '1', next: '1', code: `No inline patch returned for ${filename}` }]
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
  const riskText = riskyFiles.length > 0 ? `Risk focus: ${riskyFiles.join(', ')}.` : 'No blocking risk was found by MVP rules.'
  const testText = files.some((file) => file.filename.toLowerCase().includes('test'))
    ? 'Tests changed in this PR; reviewers should confirm they cover the risky paths.'
    : 'No test file was detected in the fetched file list; QA should define regression coverage explicitly.'

  return `${pr.title}. The PR changes ${files.length} files with ${compactNumber(pr.additions + pr.deletions)} lines touched. ${riskText} ${testText}`
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
    ['Git diff', `${review.metrics.changedLines} changed lines`, 'ready'],
    ['Full files', `${review.metrics.files} touched files`, review.source.includes('GitHub') ? 'ready' : 'demo'],
    ['Dependency map', 'package.json, lockfile', 'planned'],
    ['Issue context', `PR #${review.pr.number}, labels`, review.source.includes('GitHub') ? 'partial' : 'demo'],
    ['Team standards', 'secure review policy', 'ready'],
  ]
}

function App() {
  const [prUrl, setPrUrl] = useState(samplePrUrl)
  const [review, setReview] = useState(sampleReview)
  const [statusMessage, setStatusMessage] = useState('MVP ready with demo PR data. Paste a public GitHub PR URL to analyze live metadata and file patches.')
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
    setStatusMessage('Fetching PR metadata, changed files, and patches from GitHub...')

    try {
      const liveReview = await fetchGitHubPullRequest(prUrl)
      setReview(liveReview)
      setActiveFindingId(liveReview.findings[0].id)
      setStatusMessage('Live GitHub PR analyzed with MVP rules. Private repos and organization docs are planned for the GitHub App iteration.')
    } catch (error) {
      setReview({
        ...sampleReview,
        status: 'fallback',
        summaryStatus: 'Demo fallback active',
      })
      setActiveFindingId(sampleReview.findings[0].id)
      setStatusMessage(`${error.message} Showing the built-in PR review demo so the workflow remains testable.`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Product navigation">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <strong>ReviewPilot</strong>
            <span>AI PR review desk</span>
          </div>
        </div>
        <nav>
          {['Review queue', 'Risk radar', 'Team rules', 'Model routing', 'Insights'].map((item, index) => (
            <button className={index === 0 ? 'nav-item active' : 'nav-item'} key={item}>
              <span>{item}</span>
              {index === 0 && <b>{review.findings.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>Current policy</span>
          <strong>P0/P1 comments only</strong>
          <p>P2 suggestions stay in the report unless reviewers opt in.</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="pr-input">
            <label htmlFor="pr-url">GitHub PR</label>
            <input
              id="pr-url"
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
            />
          </div>
          <button className="primary-button" type="button" onClick={runAnalysis} disabled={isAnalyzing}>
            {isAnalyzing ? 'Analyzing...' : 'Analyze PR'}
          </button>
        </header>

        <div className={`status-banner ${review.status === 'fallback' ? 'warning' : ''}`}>
          <b>{review.source}</b>
          <span>{statusMessage}</span>
        </div>

        <section className="summary-row">
          <article className="summary-panel">
            <div className="section-heading">
              <span>PR Summary</span>
              <strong>{isAnalyzing ? 'Streaming draft' : review.summaryStatus}</strong>
            </div>
            <h1>{review.pr.title}</h1>
            <p>{review.summary}</p>
            <div className="pr-meta">
              <span>{review.pr.repo}</span>
              <span>#{review.pr.number}</span>
              <span>{review.pr.branch} to {review.pr.base}</span>
              <span>opened by {review.pr.author}</span>
            </div>
            <div className="summary-metrics">
              <span><strong>{review.metrics.files}</strong> files</span>
              <span><strong>{review.metrics.changedLines}</strong> changed lines</span>
              <span><strong>{review.metrics.highRiskPaths}</strong> high-risk paths</span>
              <span><strong>{review.metrics.testsMissing}</strong> tests missing</span>
            </div>
          </article>

          <article className="target-panel">
            <div className="section-heading">
              <span>Review Target</span>
              <strong>AI-era ownership</strong>
            </div>
            <div className="target-grid">
              <div>
                <b>Code artifact</b>
                <p>Does the diff preserve behavior, security, and maintainability?</p>
              </div>
              <div>
                <b>AI-agent trace</b>
                <p>Did the generation path create brittle fixes, loops, or missing rationale?</p>
              </div>
              <div>
                <b>Human owner</b>
                <p>Who accepts product intent, risk tradeoffs, and production accountability?</p>
              </div>
            </div>
          </article>
        </section>

        <section className="review-grid">
          <article className="findings-panel">
            <div className="section-heading">
              <span>Risk Findings</span>
              <strong>{visibleFindings.length} visible</strong>
            </div>
            <div className="filters" aria-label="Noise controls">
              <label>
                Minimum severity
                <select value={minSeverity} onChange={(event) => setMinSeverity(event.target.value)}>
                  <option>P0</option>
                  <option>P1</option>
                  <option>P2</option>
                </select>
              </label>
              <label>
                Confidence {confidence}%
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
                  No findings match the current noise filter.
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
              <span>Inline Review</span>
              <strong>{selectedFinding.file}:{selectedFinding.line}</strong>
            </div>
            <div className="diff-viewer" aria-label="Code diff viewer">
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
              <p><b>Evidence:</b> {selectedFinding.evidence}</p>
              <div className="suggestion-block">
                <span>Suggested fix</span>
                <code>{selectedFinding.suggestion}</code>
              </div>
              <div className="comment-actions">
                <button type="button">Commit suggestion</button>
                <button
                  className={feedback === 'useful' ? 'active' : ''}
                  type="button"
                  onClick={() => setFeedback('useful')}
                >
                  Useful
                </button>
                <button
                  className={feedback === 'noisy' ? 'active' : ''}
                  type="button"
                  onClick={() => setFeedback('noisy')}
                >
                  Too noisy
                </button>
              </div>
            </div>
          </article>

          <aside className="context-panel">
            <div className="section-heading">
              <span>Context Pipeline</span>
              <strong>5 sources</strong>
            </div>
            <div className="source-list">
              {contextSources(review).map(([name, detail, status]) => (
                <div className="source-row" key={name}>
                  <span>{name}</span>
                  <b>{detail}</b>
                  <em className={status}>{status}</em>
                </div>
              ))}
            </div>

            <div className="model-box">
              <span>Model routing</span>
              <div>
                <b>Fast summary</b>
                <p>MVP uses local summarization now; production routes this to a low-cost fast model.</p>
              </div>
              <div>
                <b>Deep risk pass</b>
                <p>Reasoning model will run only on risky files, auth paths, data access, and prompt changes.</p>
              </div>
            </div>

            <div className="roadmap-box">
              <span>Future expansion</span>
              <p>IDE pre-review, GitHub App auth, private repo context, auto-fix branches with tests, and quality analytics.</p>
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

export default App
