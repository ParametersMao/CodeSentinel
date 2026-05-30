# CodeSentinel GitHub App Backend

This directory contains the engineering-realization backend for CodeSentinel. The current version is a dependency-light GitHub App webhook service that can accept pull request events and convert them into structured review jobs.

## Local Commands

```bash
npm run server:check
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

## Environment Variables

```bash
PORT=8787
GITHUB_WEBHOOK_SECRET=change-me
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

`GITHUB_WEBHOOK_SECRET` is optional for local development. When configured, the server verifies `x-hub-signature-256` using HMAC SHA-256 before accepting a payload.

## Current Scope

Implemented:

- Webhook payload receiving.
- Optional GitHub signature verification.
- Pull request event filtering.
- Structured review job creation.
- Three-lane analysis plan: guardrail, intent, architecture.

Next:

- Read `.ai-reviewer.yml` from the target repository.
- Create GitHub Check Runs.
- Publish PR summary comments and inline review comments.
- Persist review feedback and analysis results.
