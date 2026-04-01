import { getAnthropic } from '../ai.js'
import { CLAUDE_MODEL, DEDUP_THRESHOLD, GITHUB_TOKEN } from '../config.js'
import { embed } from '../core.js'
import { nearestLogs } from '../db.js'
import { logKnowledge } from './log-knowledge.js'
import { generateStudyCards } from './generate-cards.js'

const REVIEW_PR_PROMPT = `\
You are reviewing a pull request diff to extract engineering knowledge worth studying.

The audience is a software engineer working on this codebase. Extract only items that
genuinely expand understanding — not things that are obvious, boilerplate, or easily Googled.

PR #{pr_number}: {pr_title}

Description:
{pr_description}

Diff:
{diff}

---

Identify up to 3 knowledge items worth logging. Each item must be one of:
- A non-obvious implementation decision and the WHY behind it
- A problem-solving or debugging strategy actually used here
- A pattern, tradeoff, or codebase convention with real engineering value
- A mental model or heuristic that makes this class of problem easier to solve

Skip: boilerplate, obvious refactors, trivial style changes, anything that doesn't
teach a transferable skill or deepen understanding of how this system works.

Return JSON only — no preamble:
{{
  "items": [
    {{
      "slug": "<5-word-max kebab-case identifier>",
      "raw_notes": "<concrete explanation: what changed, why, what the insight is, what to watch for. 3-8 sentences. Be specific — name the actual classes, functions, values involved.>",
      "tags": ["<tag1>", "<tag2>"]
    }}
  ]
}}

If there is genuinely nothing worth logging, return {{"items": []}}`

async function fetchGithub(path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })
}

async function fetchDiff(owner: string, repo: string, prNumber: number): Promise<string> {
  const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3.diff',
    },
  })
  if (!resp.ok) throw new Error(`Failed to fetch diff: ${resp.status}`)
  return resp.text()
}

export async function reviewPr(prNumber: number, owner: string, repo: string): Promise<string> {
  // Fetch PR metadata
  const metaResp = await fetchGithub(`/repos/${owner}/${repo}/pulls/${prNumber}`)
  if (!metaResp.ok) {
    return `Could not fetch PR #${prNumber}: ${metaResp.status} ${metaResp.statusText}`
  }
  const meta = await metaResp.json() as { title?: string; body?: string }
  const prTitle = meta.title || ''
  const prDescription = (meta.body || '').slice(0, 2000)

  // Fetch diff
  const diff = (await fetchDiff(owner, repo, prNumber)).slice(0, 12000)

  // Ask Claude to extract knowledge items
  const prompt = REVIEW_PR_PROMPT
    .replaceAll('{pr_number}', String(prNumber))
    .replaceAll('{pr_title}', prTitle)
    .replaceAll('{pr_description}', prDescription || '(no description)')
    .replaceAll('{diff}', diff)

  const ai = getAnthropic()
  const msg = await ai.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  let items: Array<{ slug: string; raw_notes: string; tags: string[] }>
  try {
    const payload = JSON.parse((msg.content[0] as { text: string }).text.trim())
    items = payload.items || []
  } catch {
    return 'Claude returned malformed JSON — skipping review_pr.'
  }

  if (!items.length) {
    return `PR #${prNumber} reviewed — no new knowledge worth logging.`
  }

  const results: string[] = []
  let loggedCount = 0
  const repoName = repo.toLowerCase()

  for (const item of items) {
    const { slug, raw_notes, tags: itemTags } = item
    if (!raw_notes) continue

    const ticketId = `PR-${prNumber}-${slug}`
    const allTags = [...(itemTags || []), 'pr-review', `pr-${prNumber}`]

    // Dedup check
    const vec = await embed(`${ticketId}\n${raw_notes}`)
    const nearest = await nearestLogs(vec, 1)
    if (nearest.length && nearest[0].similarity >= DEDUP_THRESHOLD) {
      results.push(`  skipped '${slug}' (already covered at ${Math.round(nearest[0].similarity * 100)}% similarity)`)
      continue
    }

    const outcome = await logKnowledge(ticketId, raw_notes, allTags, repoName)
    results.push(`  logged '${slug}': ${outcome.split('\n')[0]}`)
    loggedCount++
  }

  if (loggedCount > 0) {
    const cardOutcome = await generateStudyCards()
    results.push(`\nStudy cards: ${cardOutcome.split('\n')[0]}`)
  }

  return `PR #${prNumber} — ${loggedCount}/${items.length} items logged\n${results.join('\n')}`
}
