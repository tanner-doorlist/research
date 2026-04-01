import { DEDUP_THRESHOLD } from '../config.js'
import {
  embed, extractProblemLine, formatWithClaude, mergeWithClaude, parseTags, slugify,
} from '../core.js'
import { nearestLogs, parseFrontmatter, upsertLog } from '../db.js'

function normalizeRepo(repo: string | null): string | null {
  if (!repo) return null
  repo = repo.trim().replace(/\/$/, '')
  for (const prefix of ['https://github.com/', 'http://github.com/', 'git@github.com:']) {
    if (repo.startsWith(prefix)) {
      repo = repo.slice(prefix.length)
      break
    }
  }
  if (repo.endsWith('.git')) repo = repo.slice(0, -4)
  if (repo.includes('/')) repo = repo.split('/').pop()!
  return repo.toLowerCase() || null
}

export async function logKnowledge(
  ticketId: string, rawNotes: string, tags: string[] = [], repo: string | null = null,
): Promise<string> {
  repo = normalizeRepo(repo)
  const embedInput = `${ticketId}\n${rawNotes}`
  const vec = await embed(embedInput)

  const nearest = await nearestLogs(vec, 1)

  if (nearest.length && nearest[0].similarity >= DEDUP_THRESHOLD) {
    const existing = nearest[0]
    const merged = await mergeWithClaude(existing.content, rawNotes)
    const mergedVec = await embed(merged.slice(0, 8000))
    const fm = parseFrontmatter(merged)

    await upsertLog(
      existing.filename, fm.date ?? null, fm.type || 'coding',
      fm.problem || existing.filename, parseTags(fm),
      merged, mergedVec, repo,
    )

    return `Merged into existing log: ${existing.filename}\nSimilarity: ${Math.round(nearest[0].similarity * 100)}%`
  }

  const formatted = await formatWithClaude(ticketId, rawNotes, tags)
  const problemLine = extractProblemLine(formatted)
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `${dateStr}-${ticketId.toLowerCase()}-${slugify(problemLine)}.md`
  const fm = parseFrontmatter(formatted)

  await upsertLog(
    filename, dateStr, fm.type || 'coding',
    fm.problem || problemLine, tags,
    formatted, vec, repo,
  )

  const preview = formatted.split('\n').slice(0, 20).join('\n')
  return `Logged: ${filename}\n\n${preview}\n...`
}
