# CodeSentinel GitHub App Backend

This directory contains the engineering-realization backend for CodeSentinel. The current version is a dependency-light GitHub App webhook service that can accept pull request events and convert them into structured review jobs.

## Local Commands

```bash
npm run server:check
npm run server:config-check
npm run server:rules-check
npm run server:model-check
npm run server:model-runtime-check
npm run server:llm-check
npm run server:ai-review-check
npm run server:github-app-check
npm run server:publish-check
npm run server:rag-check
npm run server:feedback-check
npm run server:review-run-check
npm run server:queue-check
npm run server:implicit-index-check
npm run server:runtime-config-check
npm run server:context-check
npm run server:dev
```

Default local URL:

```text
http://127.0.0.1:8787
```

## Routes

- `GET /health`: health check for deployment and local debugging.
- `GET /runtime-config`: read runtime configuration with secret values masked.
- `POST /runtime-config`: save runtime configuration from the Web UI.
- `GET /webhooks/github/example`: sample GitHub webhook payload and the review job it creates.
- `POST /webhooks/github`: GitHub webhook endpoint for `pull_request` events. When `WEBHOOK_AUTO_PUBLISH=true`, it creates a running Check Run first, then publishes the completed review result.
- `POST /analysis/rules`: direct rule analysis API for local services and future workers.
- `POST /analysis/ai-review`: run rule analysis, RAG context recall, model routing, and AI-generated review.
- `POST /publish/github`: publish AI Review result as a GitHub Check Run and PR conversation comment.
- `POST /feedback`: persist reviewer feedback events.
- `GET /feedback/summary`: summarize persisted feedback events.
- `GET /review-runs`: read the latest persisted review run records.
- `GET /review-runs/summary`: summarize persisted review run records for dashboards.
- `GET /review-jobs`: inspect in-memory async webhook review jobs.
- `GET /review-jobs/:id`: inspect one async webhook review job.

## Environment Variables

```bash
PORT=8787
GITHUB_WEBHOOK_SECRET=change-me
GITHUB_TOKEN=
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_PRIVATE_KEY_PATH=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_INSTALLATION_ID=
WEBHOOK_AUTO_PUBLISH=false
WEBHOOK_ASYNC_PROCESSING=true
AI_REVIEWER_CONFIG_PATH=.ai-reviewer.yml
FEEDBACK_STORE_PATH=data/feedback.jsonl
REVIEW_RUN_STORE_PATH=data/review-runs.jsonl
IMPLICIT_STANDARD_INDEX_PATH=data/implicit-standards.json
RUNTIME_CONFIG_PATH=data/runtime-config.json
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_BEARER_TOKEN=
JIRA_PROJECT_KEYS=
AI_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_SUMMARY_MODEL=gpt-4o-mini
OPENAI_RISK_MODEL=gpt-4o
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_SUMMARY_MODEL=claude-3-5-haiku-latest
ANTHROPIC_RISK_MODEL=claude-3-5-sonnet-latest
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_SUMMARY_MODEL=deepseek-chat
DEEPSEEK_RISK_MODEL=deepseek-reasoner
QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_SUMMARY_MODEL=qwen-turbo
QWEN_RISK_MODEL=qwen-plus
```

`GITHUB_WEBHOOK_SECRET` is optional for local development. When configured, the server verifies `x-hub-signature-256` using HMAC SHA-256 before accepting a payload.

## Current Scope

Implemented:

- Webhook payload receiving.
- Optional GitHub signature verification.
- Pull request event filtering.
- Structured review job creation.
- Three-lane analysis plan: guardrail, intent, architecture.
- Real `.ai-reviewer.yml` loading, YAML parsing, normalization, and job snapshotting.
- Rule engine service module for P0/P1 findings, merge gate state, health score, and low-risk checklist.
- Model route planning for summary, intent, risk, and architecture tasks with latency budget and fallback strategy.
- Local RAG-style context retriever for implicit standards and changed-file patches.
- Local implicit standard index that accumulates historical code snippets for later RAG recall.
- JSONL feedback persistence for helpful, unhelpful, accepted, ignored, and missed-risk events.
- JSONL review run persistence for audit trails, review quality dashboards, and future trend analysis.
- In-memory async webhook queue so GitHub receives a fast 202 response while analysis continues in the background.
- GitHub API context client for changed files, full files, dependency files, linked Issues, and historical code snippets.
- Optional Jira context connector for PR-linked issue keys such as `ABC-123`.
- Model runtime configuration for OpenAI, Anthropic, DeepSeek, Qwen, and local fallback providers.
- Runtime configuration API for Web UI setup without editing `.env`.
- AI review generation through OpenAI-compatible chat completions for OpenAI, DeepSeek, and Qwen.
- GitHub publishing for Check Runs and PR homepage comments, including a Webhook-triggered running-to-completed Check Run flow.
- GitHub App JWT and Installation Token exchange for private repository access.

## Real Model Smoke

After saving provider credentials in the Web UI and starting the backend, run:

```bash
npm run server:ai-review-smoke
```

This command calls the configured model and consumes provider tokens. If the model call fails, the API returns a fallback review generated from the local rule engine.

## GitHub Publish

`POST /publish/github` writes GitHub review artifacts:

- GitHub Check Run: `CodeSentinel AI Review`
- PR homepage comment: `CodeSentinel 变更验收报告`
- Diff inline comments for up to five P0/P1 risks with valid changed-file locations.

It requires a token with Checks and Pull Requests / Issues write permissions. The backend now prefers GitHub App Installation Token when `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, and `GITHUB_INSTALLATION_ID` are configured, and falls back to `GITHUB_TOKEN`. Inline comment failures are returned as skipped items so a single invalid diff line does not block the full report.

Next:

- Replace the local RAG scorer with a durable vector database.
- Replace the local implicit standard index with an embedding-backed vector database.
- Replace the in-memory async queue with a durable worker queue for multi-instance deployments.
- Move review run storage from local JSONL to a durable database.
