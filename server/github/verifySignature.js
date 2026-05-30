import { createHmac, timingSafeEqual } from 'node:crypto'

const signaturePrefix = 'sha256='

export function createGitHubSignature(secret, body) {
  return `${signaturePrefix}${createHmac('sha256', secret).update(body).digest('hex')}`
}

export function verifyGitHubSignature({ secret, body, signature }) {
  if (!secret) {
    return { ok: true, skipped: true, reason: 'GITHUB_WEBHOOK_SECRET is not configured' }
  }

  if (!signature || !signature.startsWith(signaturePrefix)) {
    return { ok: false, skipped: false, reason: 'Missing x-hub-signature-256 header' }
  }

  const expected = Buffer.from(createGitHubSignature(secret, body))
  const actual = Buffer.from(signature)

  if (expected.length !== actual.length) {
    return { ok: false, skipped: false, reason: 'Signature length mismatch' }
  }

  return {
    ok: timingSafeEqual(expected, actual),
    skipped: false,
    reason: 'Signature verified',
  }
}
