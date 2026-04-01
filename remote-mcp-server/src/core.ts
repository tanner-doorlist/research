import { getAnthropic, getOpenAI } from './ai.js'
import { CLAUDE_MODEL, EMBED_MODEL } from './config.js'

// ── Embedding ──────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const openai = getOpenAI()
  const resp = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text.slice(0, 8000),
  })
  return resp.data[0].embedding
}

// ── Text helpers ───────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50)
}

export function extractProblemLine(markdown: string): string {
  for (const line of markdown.split('\n')) {
    if (line.startsWith('problem:')) {
      return line.split(':', 2)[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  return 'untitled'
}

export function parseTags(fm: Record<string, string>): string[] {
  try {
    const parsed = JSON.parse(fm.tags || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function extractSections(markdown: string, sectionNames: string[]): string {
  const lines = markdown.split('\n')
  let capture = false
  const out: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim()
      capture = sectionNames.some(s => heading.startsWith(s))
    } else if (capture) {
      out.push(line)
    }
  }

  const text = out.join('\n').trim()
  return text ? text.slice(0, 800) : markdown.slice(0, 800)
}

// ── Prompt templates ───────────────────────────────────────────────────────

const FORMAT_PROMPT = `\
You are formatting raw developer notes into a structured knowledge log.

Ticket: {ticket_id}
Date: {date}

Raw notes:
{raw_notes}

Output ONLY valid markdown using this exact template. Be concise. \
Every section must be filled — use "N/A" if genuinely not applicable.

---
date: {date}
type: coding
problem: <one-line problem description>
tags: [{tags}]
---

## Problem
<what was asked or what broke; relevant context>

## Initial Observations
<what was noticed first; what was ambiguous>

## Approach
<numbered step-by-step reasoning; what hypotheses were formed and checked>

1.
2.
3.

## Key Insights
<the non-obvious things; mental models or heuristics that applied>

-

## Solution
<the final answer, fix, or output>

## Pitfalls / What to Watch For
<what would have led someone astray; wrong early assumptions>

-

## Study Prompts
Q: <key diagnostic or reasoning question>
A: <answer>
---`

const MERGE_PROMPT = `\
Two knowledge logs cover overlapping material. Merge them into one comprehensive log that:
- Deduplicates repeated information (keep the clearest version)
- Preserves unique insights from both
- Maintains the same markdown template structure

EXISTING LOG:
{existing}

NEW NOTES:
{new_notes}

Output ONLY the merged markdown — no preamble, no explanation.`

// ── Claude formatting ──────────────────────────────────────────────────────

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}

export async function formatWithClaude(ticketId: string, rawNotes: string, tags: string[]): Promise<string> {
  const tagStr = tags.map(t => `"${t}"`).join(', ')
  const date = new Date().toISOString().slice(0, 10)
  const prompt = fillTemplate(FORMAT_PROMPT, {
    ticket_id: ticketId,
    date,
    raw_notes: rawNotes,
    tags: tagStr,
  })
  const ai = getAnthropic()
  const msg = await ai.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })
  return (msg.content[0] as { text: string }).text.trim()
}

export async function mergeWithClaude(existing: string, newNotes: string): Promise<string> {
  const prompt = fillTemplate(MERGE_PROMPT, { existing, new_notes: newNotes })
  const ai = getAnthropic()
  const msg = await ai.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })
  return (msg.content[0] as { text: string }).text.trim()
}
