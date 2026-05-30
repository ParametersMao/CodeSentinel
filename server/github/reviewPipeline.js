export const pullRequestActions = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review'])

export const analysisSteps = [
  {
    key: 'guardrail',
    name: '拦截层',
    goal: '匹配硬性规则、P0 Blocker、安全红线和目录边界。',
    targetMs: 3000,
  },
  {
    key: 'intent',
    name: '意图层',
    goal: '对比 Issue、PR 描述、标题与 Code Diff，判断是否偏离需求。',
    targetMs: 9000,
  },
  {
    key: 'architecture',
    name: '架构层',
    goal: '检索存量代码和隐式规范，识别模式破坏、重复实现和上下文缺失。',
    targetMs: 18000,
  },
]

export function shouldAnalyzePullRequest(eventName, action) {
  return eventName === 'pull_request' && pullRequestActions.has(action)
}

export function createPullRequestJob(payload, eventName = 'pull_request') {
  const pullRequest = payload.pull_request ?? {}
  const repository = payload.repository ?? {}
  const installation = payload.installation ?? {}
  const action = payload.action ?? 'unknown'
  const shouldAnalyze = shouldAnalyzePullRequest(eventName, action)

  return {
    id: [
      repository.full_name ?? 'unknown-repo',
      pullRequest.number ?? 'unknown-pr',
      pullRequest.head?.sha?.slice(0, 12) ?? 'unknown-sha',
      Date.now(),
    ].join(':'),
    status: shouldAnalyze ? 'queued' : 'ignored',
    reason: shouldAnalyze ? 'pull_request event accepted' : `event ${eventName}/${action} does not trigger analysis`,
    event: eventName,
    action,
    installationId: installation.id ?? null,
    repository: {
      id: repository.id ?? null,
      name: repository.name ?? null,
      fullName: repository.full_name ?? null,
      private: Boolean(repository.private),
      defaultBranch: repository.default_branch ?? null,
    },
    pullRequest: {
      number: pullRequest.number ?? null,
      title: pullRequest.title ?? '',
      url: pullRequest.html_url ?? '',
      author: pullRequest.user?.login ?? '',
      base: pullRequest.base?.ref ?? '',
      head: pullRequest.head?.ref ?? '',
      headSha: pullRequest.head?.sha ?? '',
      changedFiles: pullRequest.changed_files ?? null,
      additions: pullRequest.additions ?? null,
      deletions: pullRequest.deletions ?? null,
    },
    pipeline: analysisSteps,
    publishPlan: {
      checkRun: shouldAnalyze,
      prSummaryComment: shouldAnalyze,
      inlineComments: shouldAnalyze,
      mergeGate: shouldAnalyze,
    },
  }
}

export function createExamplePullRequestPayload() {
  return {
    action: 'opened',
    installation: { id: 421 },
    repository: {
      id: 1001,
      name: 'codesentinel',
      full_name: 'acme/codesentinel',
      private: true,
      default_branch: 'main',
    },
    pull_request: {
      number: 42,
      title: '新增租户权限校验',
      html_url: 'https://github.com/acme/codesentinel/pull/42',
      user: { login: 'developer-a' },
      base: { ref: 'main' },
      head: { ref: 'feature/tenant-guard', sha: '7f4a8c6b2d1e9a0f1b2c3d4e5f67890123456789' },
      changed_files: 8,
      additions: 320,
      deletions: 41,
    },
  }
}
