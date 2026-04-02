import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { logKnowledge } from './tools/log-knowledge.js'
import { searchKnowledge } from './tools/search-knowledge.js'
import { generateStudyCards } from './tools/generate-cards.js'
import { reviewPr } from './tools/review-pr.js'

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'knowledge-scribe',
    version: '0.1.0',
  })

  server.tool(
    'log_knowledge',
    'Log knowledge gained from working on a ticket. Claude formats the notes, checks for duplicates via embedding similarity, merges if overlapping, and persists to Postgres.',
    {
      ticket_id: z.string().describe('Ticket ID, e.g. DLE-123'),
      raw_notes: z.string().describe('Verbose raw notes — what you did, why, what broke, what worked'),
      tags: z.array(z.string()).optional().describe('Optional list of topic tags'),
      repo: z.string().optional().describe('Optional repo name or URL for scoping'),
    },
    async ({ ticket_id, raw_notes, tags, repo }) => ({
      content: [{ type: 'text' as const, text: await logKnowledge(ticket_id, raw_notes, tags || [], repo || null) }],
    }),
  )

  server.tool(
    'search_knowledge',
    'Semantic search over all indexed knowledge logs. Returns the most relevant log excerpts.',
    {
      query: z.string().describe('Natural language query'),
      n_results: z.number().optional().default(3).describe('Number of results to return'),
    },
    async ({ query, n_results }) => ({
      content: [{ type: 'text' as const, text: await searchKnowledge(query, n_results) }],
    }),
  )

  server.tool(
    'generate_study_cards',
    'Convert unprocessed problem logs into Q&A and concept flashcards.',
    {},
    async () => ({
      content: [{ type: 'text' as const, text: await generateStudyCards() }],
    }),
  )

  server.tool(
    'review_pr',
    'Extract engineering knowledge from a PR diff, log it, and generate study cards.',
    {
      pr_number: z.number().describe('GitHub PR number'),
      owner: z.string().describe('GitHub repo owner, e.g. "tanner-doorlist"'),
      repo: z.string().describe('GitHub repo name, e.g. "doorlite-next"'),
      github_token: z.string().describe('GitHub personal access token with repo read access'),
    },
    async ({ pr_number, owner, repo, github_token }) => ({
      content: [{ type: 'text' as const, text: await reviewPr(pr_number, owner, repo, github_token) }],
    }),
  )

  return server
}
