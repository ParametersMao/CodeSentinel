# CodeSentinel GitHub App Backend

This directory contains the engineering-realization backend for CodeSentinel. The current version is a dependency-light GitHub App webhook service that can accept pull request events and convert them into structured review jobs.

## Local Commands

```bash
npm run server:check
npm run server:config-check
npm run server:rules-check
npm run server:model-check
npm run server:rag-check
npm run server:feedback-check
npm run server:context-check
npm run server:dev
```

Default local URL:

```text
http://127.0.0.1:8787
```

## Routes

- `GET /health`: health check for deployment and local debugging.
- `GET /webhooks/github/example`: sample GitHub webhook payload and the review job it creates.
- `POST /webhooks/github`: GitHub webhook endpoint for `pull_request` events.
- `POST /analysis/rules`: direct rule analysis API for local services and future workers.
- `POST /feedback`: persist reviewer feedback events.
- `GET /feedback/summary`: summarize persisted feedback events.

## Environment Variables

```bash
PORT=8787
GITHUB_WEBHOOK_SECRET=change-me
GITHUB_TOKEN=
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_INSTALLATION_ID=
AI_REVIEWER_CONFIG_PATH=.ai-reviewer.yml
FEEDBACK_STORE_PATH=data/feedback.jsonl
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
- JSONL feedback persistence for helpful, unhelpful, accepted, ignored, and missed-risk events.
- GitHub API context client for changed files, full files, dependency files, linked Issues, and historical code snippets.

Next:

- Replace the local RAG scorer with a durable vector database.
- Create GitHub Check Runs.
- Publish PR summary comments and inline review comments.
- Persist review feedback and analysis results.
