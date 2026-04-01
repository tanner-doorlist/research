import { embed, extractSections } from '../core.js'
import { nearestLogs } from '../db.js'

export async function searchKnowledge(query: string, nResults = 3): Promise<string> {
  const vec = await embed(query)
  const results = await nearestLogs(vec, nResults)

  if (!results.length) return 'No matching knowledge found.'

  const parts = results.map(row => {
    const excerpt = extractSections(row.content, ['Key Insights', 'Solution', 'Pitfalls'])
    return `### ${row.filename}  (similarity ${Math.round(row.similarity * 100)}%)\ndate: ${row.date || '?'}\n\n${excerpt}`
  })

  return parts.join('\n\n---\n\n')
}
