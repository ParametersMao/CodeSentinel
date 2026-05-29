# ReviewPilot

ReviewPilot is a minimum viable product for AI-assisted GitHub Pull Request review. It focuses on helping engineering teams shorten review cycles, improve risk detection, and reduce noisy AI comments.

## Product Positioning

The tool reviews the code artifact first, but it also models two extra AI-era responsibilities:

- Code artifact: whether the diff is safe, correct, maintainable, and testable.
- AI-agent trace: whether generated code shows prompt loops, shallow fixes, missing rationale, or absent test hypotheses.
- Human owner: who accepts product intent, operational risk, and production accountability.

This keeps the review from becoming a personal critique of the developer while still preserving human responsibility.

## Core Experience

- Public GitHub PR ingestion: paste a PR URL and the app fetches PR metadata plus changed-file patches from GitHub's public REST API.
- PR summary: explains feature changes, core logic changes, breaking risk, and QA test scope.
- Inline review: highlights risky lines with severity, evidence, impact, and a suggested fix.
- Noise control: filters comments by severity and confidence so only high-value findings reach the GitHub PR.
- Context pipeline: combines diff, full files, dependency manifests, issue context, and team standards.
- Model routing: uses a fast low-cost model for summaries and a stronger reasoning model for risky code paths.

## MVP Scope

This version uses a local, explainable review engine to simulate the AI analysis layer. It scans fetched patches for high-risk signals such as permission changes, tenant-scope removal, dynamic query construction, unsafe DOM/runtime execution, AI-agent prompt loops, and missing tests.

If a public PR cannot be fetched, or the PR is private, the app falls back to a built-in demo review so the workflow remains testable. The next iteration should replace the local rule engine with a model-backed API and add GitHub App authentication for private repositories.

## Architecture Direction

1. GitHub App receives PR webhooks and fetches diff, full files, checks, labels, and author metadata.
2. A retriever expands context with nearby call sites, tests, dependency files, issues, and team rules.
3. A router sends summary work to a fast model and deep risk analysis to a stronger reasoning model.
4. A filter deduplicates findings, scores confidence, maps severity, and suppresses low-value comments.
5. Results are published asynchronously to the PR body, inline comments, and team reporting views.

## Current Limitations

- Public repositories only; private repos require a GitHub App token.
- Analysis is local rule-based simulation, not a live LLM call yet.
- GitHub inline comment publishing is represented in the UI but not posted back to GitHub.
- Full-file and organization-doc context are shown in the pipeline, with live implementation planned after auth.

## Acceptance And Optimization Plan

See `docs/optimization-plan.md` for the MVP acceptance result, iteration plan, and self-developed originality statement.

## Future Expansion

- IDE pre-review before commit or PR creation.
- Auto-fix branches that apply suggestions and run tests.
- Reviewer calibration based on accepted, rejected, and ignored AI comments.
- Engineering quality analytics for recurring risk categories and team training.

## Run Locally

```bash
npm install
npm run dev
```
