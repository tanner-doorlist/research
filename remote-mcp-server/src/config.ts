export const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/study_notifier'

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
export const TEAM_TOKEN = process.env.TEAM_TOKEN || ''
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
export const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small'
export const DEDUP_THRESHOLD = parseFloat(process.env.DEDUP_THRESHOLD || '0.88')

export const PORT = parseInt(process.env.PORT || '3000', 10)
