# ReviewPilot MVP Acceptance And Optimization Plan

## MVP Acceptance Result

The current MVP is accepted as a functional baseline.

Completed capabilities:

- Public GitHub PR URL input.
- GitHub public REST API fetch for PR metadata and changed-file patches.
- Local explainable review engine for first-pass risk detection.
- PR summary, risk findings, inline review panel, suggested fixes, severity labels, confidence filtering, and feedback controls.
- Review target model for AI-era ownership: code artifact, AI-agent trace, and human owner.
- Fallback demo flow when a PR is private, unavailable, invalid, or blocked by API limits.
- Responsive desktop and mobile layouts.

Verification performed:

- `npm run lint` passed.
- `npm run build` passed.
- Public PR flow was tested with `https://github.com/vitejs/vite/pull/22544`.
- Fallback flow was tested with the built-in demo PR.
- Desktop and mobile screenshots were generated for visual review.

Current MVP boundary:

- The analysis layer is rule-based and explainable. It simulates the AI review layer but does not yet call a live LLM.
- Public repositories are supported. Private repositories require GitHub App authentication in a later iteration.
- GitHub inline comments are represented in the UI but are not posted back to GitHub yet.
- Full-file context, organization standards, issue context, and RAG are shown in the product pipeline and should be implemented after authentication.

## Product Originality And Self-Developed Position

ReviewPilot should be treated as a self-developed product, not a clone of any existing AI code review tool.

Original product decisions in this MVP:

- The review object is split into three layers: code artifact, AI-agent trace, and human owner. This is the core product thesis and should remain a differentiator.
- The tool is positioned as a team risk arbitration layer, not a generic comment generator.
- Noise control is designed as a first-class workflow through severity, confidence, and reviewer feedback.
- The context pipeline is explicit and visible to users, so reviewers can understand why the system reached a conclusion.
- Model routing is part of the product experience, not only a backend implementation detail.

Anti-plagiarism principles:

- Do not copy interface layouts, copywriting, icons, visual identity, product flows, or documentation from existing commercial tools.
- Use competitor research only to understand user needs, not to reproduce specific designs.
- Keep the brand name, information architecture, visual language, examples, and product narrative original.
- Use open-source libraries only according to their licenses and document any material dependency added later.
- When adding model prompts, review rules, sample data, or benchmark cases, write them in-house or use properly licensed public examples.
- Do not market the product with claims, screenshots, or UI patterns that could imply affiliation with another product.

## Iteration Plan

### Iteration 1: MVP Hardening

Goal: make the current local product reliable enough for demos and early user feedback.

Tasks:

- Add clearer empty states when filters hide all findings.
- Add URL validation before calling GitHub.
- Add loading states for PR fetch, patch parsing, analysis, and report generation.
- Improve rule explanations so each finding has evidence, impact, confidence reason, and suggested verification.
- Add local persistence for the last analyzed PR and user feedback.
- Add a small test fixture set for patch parsing and rule detection.

Acceptance criteria:

- A user can analyze a public PR without reading setup docs.
- Invalid or private PRs fail gracefully and preserve the demo workflow.
- Findings are understandable without extra explanation from the presenter.

### Iteration 2: Real AI Review API

Goal: replace the rule-only analyzer with a model-backed review service while keeping rule explanations as guardrails.

Tasks:

- Create a backend API boundary for analysis.
- Add model routing:
  - Fast model for PR summary and QA scope.
  - Strong reasoning model for high-risk hunks.
  - Embedding/retrieval model for repository and policy context.
- Add prompt contracts for summary, risk detection, suggested fixes, and confidence scoring.
- Add structured JSON output validation to avoid malformed model responses.
- Add deduplication and severity normalization after model output.

Acceptance criteria:

- Model output is structured, traceable, and filterable.
- The app can explain why a finding was shown.
- Low-confidence comments are suppressed by default.

### Iteration 3: GitHub App Integration

Goal: support private repositories and publish review results back into GitHub.

Tasks:

- Implement GitHub App authentication.
- Fetch private PR diffs, full files, checks, labels, comments, and CODEOWNERS.
- Post PR summary as a comment or managed PR body section.
- Post P0/P1 inline review comments.
- Keep P2 findings in the ReviewPilot report unless the reviewer opts in.
- Store feedback signals from reviewer actions.

Acceptance criteria:

- A team can install the GitHub App on a repository.
- ReviewPilot can analyze private PRs.
- ReviewPilot can publish and update comments without duplicating old comments.

### Iteration 4: Context Intelligence

Goal: reduce false positives and missed risks by improving context retrieval.

Tasks:

- Retrieve full touched files and nearby call sites.
- Fetch dependency manifests, test files, route/config files, and schema/migration files.
- Support team rule documents and secure coding standards.
- Connect issue or ticket context where available.
- Add repository-specific risk profiles, such as auth-heavy services, payment services, or multi-tenant data paths.

Acceptance criteria:

- Findings cite the context sources used.
- The same diff receives better severity and confidence after repository context is added.
- Reviewers can inspect context instead of trusting a black-box answer.

### Iteration 5: Developer Workflow And Team Value

Goal: move from a useful tool to an enterprise product.

Tasks:

- Add IDE pre-review for VS Code or JetBrains.
- Add auto-fix branch creation with test execution.
- Add reviewer calibration from accepted, rejected, and ignored findings.
- Add team dashboards for recurring risks, review latency, and escaped defect categories.
- Add organization-level controls for privacy, retention, model providers, and audit logs.

Acceptance criteria:

- Teams can measure review time saved and risk classes reduced.
- ReviewPilot helps engineering leaders identify training and process gaps.
- Developers can use it before PR creation, not only after review starts.

## Design Direction For Future Iterations

Keep the interface operational and work-focused.

Design rules:

- Prioritize dense but readable review workflows over marketing-style presentation.
- Keep PR summary, risk findings, diff context, and model/context transparency visible together on desktop.
- On mobile, prioritize review triage and summary reading rather than full diff analysis.
- Avoid decorative clutter, copied dashboard patterns, and generic AI-product visual tropes.
- Make confidence, severity, and context sources explainable at the point of decision.

## Recommended Next Step

The next engineering step should be Iteration 1 hardening plus a small test suite for the patch parser and rule analyzer. That creates a stable base before adding a live model API or GitHub App permissions.
