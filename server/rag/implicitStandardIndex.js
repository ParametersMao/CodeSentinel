import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function getImplicitStandardIndexPath(env = process.env) {
  return path.resolve(env.IMPLICIT_STANDARD_INDEX_PATH ?? 'data/implicit-standards.json')
}

function normalizeSlice(input) {
  return {
    id: String(input.id),
    source: input.source ? String(input.source) : 'implicit-standard-index',
    title: input.title ? String(input.title) : input.path ? String(input.path) : 'Implicit standard',
    repository: input.repository ? String(input.repository) : '',
    path: input.path ? String(input.path) : '',
    content: String(input.content ?? '').slice(0, 6000),
    updatedAt: new Date().toISOString(),
  }
}

export function readImplicitStandardIndexSync({ indexPath = getImplicitStandardIndexPath() } = {}) {
  if (!existsSync(indexPath)) {
    return []
  }

  return JSON.parse(readFileSync(indexPath, 'utf8'))
}

export async function readImplicitStandardIndex({ indexPath = getImplicitStandardIndexPath() } = {}) {
  try {
    return JSON.parse(await readFile(indexPath, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

export async function upsertImplicitStandardSlices({ slices, indexPath = getImplicitStandardIndexPath() }) {
  const current = await readImplicitStandardIndex({ indexPath })
  const byId = new Map(current.map((slice) => [slice.id, slice]))

  for (const slice of slices) {
    const normalized = normalizeSlice(slice)

    if (normalized.id && normalized.content) {
      byId.set(normalized.id, normalized)
    }
  }

  const next = [...byId.values()].slice(-500)

  await mkdir(path.dirname(indexPath), { recursive: true })
  await writeFile(indexPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

  return next
}

export async function upsertImplicitStandardsFromContext({ repository, githubContext, indexPath = getImplicitStandardIndexPath() }) {
  const snippets = githubContext?.historicalSnippets ?? []
  const slices = snippets.map((snippet) => ({
    id: `implicit:${repository}:${snippet.path}`,
    source: 'historical-good-slices',
    repository,
    path: snippet.path,
    title: snippet.path,
    content: snippet.content,
  }))

  return upsertImplicitStandardSlices({ slices, indexPath })
}

async function runCheck() {
  const indexPath = path.join(os.tmpdir(), `codesentinel-implicit-standards-${Date.now()}.json`)

  await upsertImplicitStandardsFromContext({
    repository: 'acme/codesentinel',
    indexPath,
    githubContext: {
      historicalSnippets: [{ path: 'server/api/auth.js', content: 'validate tenant auth before merge' }],
    },
  })

  const slices = readImplicitStandardIndexSync({ indexPath })
  await rm(indexPath, { force: true })

  if (slices.length !== 1 || !slices[0].content.includes('tenant auth')) {
    throw new Error('Implicit standard index self-check failed')
  }

  console.log(JSON.stringify({ ok: true, slices: slices.length, topSlice: slices[0].id }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun && process.argv.includes('--check')) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
