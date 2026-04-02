import { getAnthropic, getOpenAI } from './ai.js'
import { CLAUDE_MODEL, EMBED_MODEL } from './config.js'
import * as db from './db.js'

// ── Vector math ─────────────────────────────────────────────────────────────

function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) dot += a[i] * b[i]
  return dot
}

function kmeansCosine(points: Float32Array[], k: number, maxIter = 40): number[] {
  const n = points.length
  const dim = points[0].length
  if (n === 0) return []
  if (k <= 1 || n <= k) return new Array(n).fill(0)

  const centroids: Float32Array[] = []
  const picked = new Set<number>()
  while (centroids.length < k && picked.size < n) {
    const j = Math.floor(Math.random() * n)
    if (picked.has(j)) continue
    picked.add(j)
    centroids.push(Float32Array.from(points[j]))
  }
  const assignments = new Array(n).fill(0)

  function assignStep() {
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestDot = -Infinity
      for (let c = 0; c < k; c++) {
        let dot = 0
        for (let d = 0; d < dim; d++) dot += points[i][d] * centroids[c][d]
        if (dot > bestDot) {
          bestDot = dot
          best = c
        }
      }
      assignments[i] = best
    }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    assignStep()
    const counts = new Array(k).fill(0)
    const sums = centroids.map(() => new Float32Array(dim))
    for (let i = 0; i < n; i++) {
      const c = assignments[i]
      counts[c]++
      for (let d = 0; d < dim; d++) sums[c][d] += points[i][d]
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue
      for (let d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / counts[c]
      normalizeVector(centroids[c])
    }
  }
  return assignments
}

// ── Embedding helpers ───────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const openai = getOpenAI()
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += 64) {
    const chunk = texts.slice(i, i + 64).map(t => t.slice(0, 8000))
    const resp = await openai.embeddings.create({ model: EMBED_MODEL, input: chunk })
    const embeddings = resp.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    for (const e of embeddings) {
      const v = new Float32Array(e)
      normalizeVector(v)
      out.push(v)
    }
  }
  return out
}

// ── Public compute functions ────────────────────────────────────────────────

export async function indexAllCardEmbeddings(): Promise<{ ok: true; count: number }> {
  const cards = await db.getAllCards()
  if (cards.length === 0) return { ok: true, count: 0 }

  const texts = cards.map((c: { front: string; back: string }) =>
    `${c.front}\n${c.back}`.slice(0, 8000),
  )
  const vecs = await embedBatch(texts)

  const data: { model: string; indexed_at: number; embeddings: Record<string, number[]> } = {
    model: EMBED_MODEL,
    indexed_at: Date.now(),
    embeddings: {},
  }
  for (let i = 0; i < cards.length; i++) {
    data.embeddings[(cards[i] as { id: string }).id] = Array.from(vecs[i])
  }
  await db.saveCardEmbeddings(data)
  return { ok: true, count: cards.length }
}

export async function semanticSearch(query: string): Promise<{ ok: true; orderedIds: string[] }> {
  const embData = await db.getCardEmbeddings()
  const embeddingsMap = embData.embeddings || {}
  if (!Object.keys(embeddingsMap).length) {
    throw new Error('No embeddings — run Index Cards first')
  }

  const [qvRaw] = await embedBatch([query])
  const scores: { cardId: string; score: number }[] = []
  for (const [cardId, emb] of Object.entries(embeddingsMap)) {
    const v = new Float32Array(emb as number[])
    normalizeVector(v)
    scores.push({ cardId, score: cosineSim(qvRaw, v) })
  }
  scores.sort((a, b) => b.score - a.score)
  return { ok: true, orderedIds: scores.map(s => s.cardId) }
}

export async function autoTagAllCards(): Promise<{ ok: true }> {
  const MAX_CLUSTERS = 7
  const MISC_THRESHOLD = 0.25

  const allCards = await db.getAllCards()
  const qa = allCards.filter((c: { type: string }) => c.type === 'qa')
  if (qa.length === 0) throw new Error('No Q&A cards to tag')

  let k = Math.min(MAX_CLUSTERS, qa.length)
  k = Math.max(2, k)

  const texts = qa.map((c: { front: string; back: string }) =>
    `${c.front}\n${c.back}`.slice(0, 12000),
  )
  const vectors = await embedBatch(texts)
  const assignments = kmeansCosine(vectors, k)

  // Compute centroids for fit quality check
  const dim = vectors[0].length
  const centroids = Array.from({ length: k }, () => new Float32Array(dim))
  const counts = new Array(k).fill(0)
  for (let i = 0; i < qa.length; i++) {
    const c = assignments[i]
    counts[c]++
    for (let d = 0; d < dim; d++) centroids[c][d] += vectors[i][d]
  }
  for (let c = 0; c < k; c++) {
    if (counts[c] === 0) continue
    for (let d = 0; d < dim; d++) centroids[c][d] /= counts[c]
    normalizeVector(centroids[c])
  }

  // Weak fits go to misc
  const isMisc = new Array(qa.length).fill(false)
  for (let i = 0; i < qa.length; i++) {
    const sim = cosineSim(vectors[i], centroids[assignments[i]])
    if (sim < MISC_THRESHOLD) isMisc[i] = true
  }

  // Label clusters with Claude
  const perCluster: string[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < qa.length; i++) {
    if (!isMisc[i]) perCluster[assignments[i]].push((qa[i] as { front: string }).front.slice(0, 200))
  }
  const samples = perCluster.map((fronts, i) => {
    const uniq = [...new Set(fronts)].slice(0, 6)
    return { cluster: i, samples: uniq.length ? uniq : [`(empty-cluster-${i})`] }
  })
  const tags = await labelClustersWithClaude(k, samples)

  // Apply tags
  for (let i = 0; i < qa.length; i++) {
    const tag = isMisc[i] ? 'misc' : (tags[assignments[i]] || 'misc')
    await db.updateCardTags((qa[i] as { id: string }).id, [tag])
  }

  return { ok: true }
}

// ── Reactive: auto-embed on card write ──────────────────────────────────────

export async function afterCardWrite(cardId: string, front: string, back: string): Promise<void> {
  try {
    const text = `${front}\n${back}`.slice(0, 8000)
    const [vec] = await embedBatch([text])
    await db.upsertCardEmbedding(cardId, EMBED_MODEL, Array.from(vec), Date.now())
  } catch (e) {
    console.error(`[compute] afterCardWrite failed for ${cardId}:`, e)
  }
}

// ── Internal: Claude cluster labeling ───────────────────────────────────────

async function labelClustersWithClaude(
  k: number,
  samples: { cluster: number; samples: string[] }[],
): Promise<string[]> {
  const ai = getAnthropic()
  const msg = await ai.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `Each cluster has sample flashcard fronts. Assign ONE short category tag per cluster: lowercase, a-z 0-9 hyphen only, max 24 characters, no spaces.

${JSON.stringify(samples, null, 2)}

Return ONLY valid JSON: {"tags":["tag0","tag1",...]} with exactly ${k} strings in cluster order 0..${k - 1}.`,
    }],
  })
  let raw = (msg.content[0] as { text: string }).text.trim()
  if (raw.startsWith('```')) raw = raw.split('\n').slice(1, -1).join('\n')
  const parsed = JSON.parse(raw)
  if (!parsed.tags || parsed.tags.length !== k) throw new Error('Unexpected tags from model')
  return parsed.tags
}
