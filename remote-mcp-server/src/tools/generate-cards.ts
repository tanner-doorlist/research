import crypto from 'crypto'
import { getAnthropic } from '../ai.js'
import { CLAUDE_MODEL } from '../config.js'
import { getUnprocessedLogs, insertCard, markCardsGenerated } from '../db.js'

const CARD_GENERATION_PROMPT = `You are a Socratic tutor creating study cards from a problem-solving log.

## Problem Log

{log_content}

## Task

Generate two types of study cards from this log:

### 1. Q&A Cards (3-6 cards)
Each card tests whether the learner could solve or reason through a similar problem themselves.
Cards should probe:
- The core diagnostic or reasoning step (not just the answer)
- Why a particular approach was chosen over alternatives
- What symptom or signal pointed toward the solution
- Any pitfall or wrong assumption to avoid

Format each card as:
Q: <question>
A: <answer>
---

### 2. Concept Cards (2-4 cards)
Each card captures one reusable mental model, heuristic, or technique revealed by this problem.
The concept should be general enough to apply beyond this specific case.

Format each card as:
CONCEPT: <name of the concept/heuristic>
WHEN TO USE: <one sentence — what situations call for this>
HOW IT WORKS: <2-3 sentences explaining the mental model or technique>
EXAMPLE: <one concrete example from the log>
---

Output exactly this JSON structure — no markdown fences, no extra text:

{{
  "qa_cards": [
    {{"front": "question text", "back": "answer text", "tags": ["tag1", "tag2"]}}
  ],
  "concept_cards": [
    {{
      "concept": "concept name",
      "when_to_use": "...",
      "how_it_works": "...",
      "example": "..."
    }}
  ]
}}`

interface CardGenResult {
  qa_cards?: Array<{ front: string; back: string; tags?: string[] }>
  concept_cards?: Array<{ concept: string; when_to_use?: string; how_it_works?: string; example?: string }>
}

async function callClaude(logContent: string): Promise<CardGenResult> {
  const ai = getAnthropic()
  const msg = await ai.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: CARD_GENERATION_PROMPT.replace('{log_content}', logContent),
    }],
  })
  let raw = (msg.content[0] as { text: string }).text.trim()
  if (raw.startsWith('```')) {
    const lines = raw.split('\n')
    raw = lines.slice(1, lines[lines.length - 1].trim() === '```' ? -1 : undefined).join('\n')
  }
  return JSON.parse(raw)
}

export async function generateStudyCards(): Promise<string> {
  const logs = await getUnprocessedLogs()
  if (!logs.length) return 'No unprocessed logs found.'

  let totalQa = 0
  let totalConcept = 0

  for (const log of logs) {
    try {
      const cards = await callClaude(log.content)

      for (const c of cards.qa_cards || []) {
        await insertCard(
          crypto.randomUUID(), 'qa', c.front, c.back,
          c.tags || [], '', '', '', log.repo || null,
        )
        totalQa++
      }

      for (const c of cards.concept_cards || []) {
        const when = c.when_to_use || ''
        const how = c.how_it_works || ''
        const example = c.example || ''
        const backParts = [
          when && `**When:** ${when}`,
          how && `**How:** ${how}`,
          example && `**Example:** ${example}`,
        ].filter(Boolean)
        const back = backParts.join('\n\n') || how

        await insertCard(
          crypto.randomUUID(), 'concept', c.concept, back,
          ['concept'], when, how, example, log.repo || null,
        )
        totalConcept++
      }

      await markCardsGenerated(log.filename)
    } catch (err) {
      console.error(`  ERROR processing ${log.filename}:`, err)
    }
  }

  return `Generated ${totalQa} Q&A cards and ${totalConcept} concept cards from ${logs.length} log(s).`
}
