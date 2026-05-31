import { readRuntimeConfig } from '../config/runtimeConfigStore.js'
import { createExamplePullRequestPayload } from '../github/reviewPipeline.js'

const response = await fetch('http://127.0.0.1:8787/analysis/ai-review', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query: 'tenant auth merge server',
    payload: createExamplePullRequestPayload(),
    files: [{ filename: 'server/api/auth.js', patch: '+ validate tenant auth before merge' }],
  }),
})
const data = await response.json()
const runtimeConfig = await readRuntimeConfig()
const provider = runtimeConfig.values.AI_DEFAULT_PROVIDER || 'local'

if (!response.ok || !data.aiReview) {
  throw new Error(`AI review smoke failed: ${JSON.stringify(data)}`)
}

console.log(
  JSON.stringify(
    {
      ok: true,
      provider,
      aiReviewStatus: data.aiReview.status,
      route: data.aiReview.route,
      summary: data.aiReview.review.summary,
      risks: data.aiReview.review.risks.length,
      error: data.aiReview.error ?? null,
    },
    null,
    2,
  ),
)
