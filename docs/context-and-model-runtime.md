# 上下文补全与模型运行时配置

本文档记录 CodeSentinel 后端在接到 GitHub Webhook 后如何补全审查上下文，以及如何通过环境变量配置大模型 Provider 和 Token。

## 当前上下文来源

1. Webhook Payload
   - 仓库名、PR 编号、标题、描述、作者、分支、head/base sha。
   - 如果请求体中包含 `files`，会作为降级上下文参与分析。

2. GitHub API 主动补全
   - `GET /repos/{owner}/{repo}/pulls/{pull_number}/files`
   - 拉取 changed files、patch、增删行、文件状态。
   - 根据 changed files 拉取 head sha 下的完整文件。
   - 根据 `.ai-reviewer.yml` 的 `context.dependencyFiles` 拉取依赖文件。
   - 从 PR 标题和描述中解析 `Fixes #123`、`Close #123` 等关联 Issue。
   - 从 base 分支 git tree 中按核心路径抽取历史代码片段，作为本地 RAG 样本。

3. `.ai-reviewer.yml`
   - 配置 Blocker 规则、核心目录、测试策略、RAG 开关、召回 topK、模型路由。

4. Jira
   - 当前只预留配置检测与结果结构，尚未接真实 Jira API。

## 降级策略

GitHub API 请求失败时，Webhook 不会直接失败。系统会返回：

- `source: github-api-unavailable`
- `error`
- 空的 full files / dependency files / issues / historical snippets
- payload 内已有 files 作为降级分析输入

这样可以保证 PR 审查链路不中断，同时在结果里暴露上下文不足原因。

## GitHub 配置

公开仓库可以不配置 token，但会受 API 限流影响。私有仓库推荐配置 GitHub App Installation Token，用于拉取上下文、创建 Check Run 和回写 PR 评论。

```bash
GITHUB_WEBHOOK_SECRET=
GITHUB_TOKEN=
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_PRIVATE_KEY_PATH=
GITHUB_INSTALLATION_ID=
WEBHOOK_AUTO_PUBLISH=false
```

当前会优先使用 `GITHUB_APP_ID`、`GITHUB_PRIVATE_KEY` 或 `GITHUB_PRIVATE_KEY_PATH`、`GITHUB_INSTALLATION_ID` 换取 Installation Token；未配置 GitHub App 时才回退到 `GITHUB_TOKEN`。`WEBHOOK_AUTO_PUBLISH=true` 后，真实 Webhook 会自动创建 Running Check Run，分析完成后更新结果并回写 PR 首页评论。

## 模型配置

`.ai-reviewer.yml` 负责声明任务类型：

```yaml
models:
  summary:
    provider: env
    model: summary
  risk:
    provider: env
    model: risk
  architecture:
    provider: env
    model: architecture
```

环境变量负责声明真实 Provider、模型名和 API Key：

```bash
AI_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_SUMMARY_MODEL=gpt-4o-mini
OPENAI_RISK_MODEL=gpt-4o
```

已预留 Provider：

- OpenAI
- Anthropic
- DeepSeek
- Qwen
- Local fallback

路由结果会返回 `provider`、`model`、`baseUrl`、`apiKeyEnv`、`credentialConfigured`，但不会返回 API Key 本身。

## 下一步

1. 接入 Jira API 和企业知识库。
2. 将本地 RAG scorer 替换为真实向量库。
3. 增加异步任务队列，避免 Webhook 请求长时间占用连接。
4. 接入 GitHub inline review comments 和 branch protection required checks。

## AI Review 调用

当前后端提供：

```text
POST /analysis/ai-review
```

该接口会串联 PR Job、规则引擎、RAG 上下文召回、模型路由和 OpenAI-compatible Chat Completions 调用。

已支持 OpenAI、DeepSeek、Qwen 这类兼容 `/chat/completions` 的 Provider。Anthropic 适配器保留为后续扩展。

本地真实模型冒烟：

```bash
npm run server:ai-review-smoke
```

该命令会消耗模型 Token，因此不会放进默认自检。

## GitHub 发布

当前后端提供：

```text
POST /publish/github
```

该接口会将 AI Review 结果发布为：

1. GitHub Check Run：`CodeSentinel AI Review`。
2. PR 首页评论：`CodeSentinel 变更验收报告`。
3. 行级 Diff 评论：默认只发布带有效文件与行号的 P0/P1 风险，最多 5 条；单条行级评论失败时会记录为 skipped，不影响 Check Run 和首页报告。

当前后端会优先使用 GitHub App Installation Token 发布；如果未配置 `GITHUB_APP_ID`、`GITHUB_PRIVATE_KEY`、`GITHUB_INSTALLATION_ID`，才回退到 `GITHUB_TOKEN`。下一步可接入 branch protection required checks。

每次 Webhook 分析或发布都会写入 `REVIEW_RUN_STORE_PATH` 指向的 JSONL 文件，默认是 `data/review-runs.jsonl`。记录只保存审查摘要、风险计数、上下文数量、模型路由和发布状态，不保存 API Key 或 GitHub 私钥。
