/** Parse @ mentions and / commands from prompt text */

export interface MentionMatch {
  type: 'card' | 'category'
  id: string        // card UUID or category tag name
  label: string     // display label
}

export interface CommandMatch {
  command: string
  args: string
}

export const COMMANDS = [
  { name: 'skip', description: 'Skip to next card' },
  { name: 'next', description: 'Move to next card' },
  { name: 'score', description: 'Override AI score (0/1/2)' },
  { name: 'conversations', description: 'View past conversations' },
  { name: 'edit', description: 'Edit this card' },
  { name: 'flag', description: 'Flag as bad card' },
  { name: 'category', description: 'Change category tag' },
  { name: 'merge', description: 'Merge with @mentioned card' },
  { name: 'delete', description: 'Delete this card' },
] as const

export type CommandName = typeof COMMANDS[number]['name']

/**
 * Extract all @mentions from text.
 * Format: @[label](id) for cards, @[#category](category:tag) for categories
 */
export function parseMentions(text: string): MentionMatch[] {
  const re = /@\[([^\]]+)\]\(([^)]+)\)/g
  const matches: MentionMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const label = m[1]
    const ref = m[2]
    if (ref.startsWith('category:')) {
      matches.push({ type: 'category', id: ref.slice('category:'.length), label })
    } else {
      matches.push({ type: 'card', id: ref, label })
    }
  }
  return matches
}

/**
 * Strip mention markup from text, leaving just the label for display.
 */
export function stripMentions(text: string): string {
  return text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
}

/**
 * Get the plain text answer (mentions stripped) for AI evaluation.
 */
export function getPlainAnswer(text: string): string {
  return stripMentions(text).replace(/\/\w+\s*/g, '').trim()
}

/**
 * Parse a / command at the start of text or at the cursor position.
 * Returns null if no command is being typed.
 */
export function parseCommand(text: string): CommandMatch | null {
  const m = text.match(/^\s*\/(\w+)\s*(.*)$/)
  if (!m) return null
  return { command: m[1], args: m[2].trim() }
}

/**
 * Check if user is currently typing a / command (for popover trigger).
 * Returns the partial command text after /, or null.
 */
export function getActiveSlash(text: string, cursorPos: number): string | null {
  // Look backward from cursor for a / that starts a command
  const before = text.slice(0, cursorPos)
  const m = before.match(/\/(\w*)$/)
  if (!m) return null
  // Only trigger if / is at start of text or preceded by whitespace
  const idx = before.lastIndexOf('/')
  if (idx > 0 && !/\s/.test(before[idx - 1])) return null
  return m[1]
}

/**
 * Check if user is currently typing an @ mention (for popover trigger).
 * Returns the partial search text after @, or null.
 */
export function getActiveMention(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos)
  // Don't trigger inside an already-completed mention @[...](...)
  const lastAt = before.lastIndexOf('@')
  if (lastAt < 0) return null
  const afterAt = before.slice(lastAt + 1)
  // If there's a completed mention pattern, skip
  if (afterAt.match(/^\[[^\]]+\]\([^)]+\)/)) return null
  // Only trigger if @ is at start or preceded by whitespace
  if (lastAt > 0 && !/\s/.test(before[lastAt - 1])) return null
  return afterAt
}

export interface FilterableItem {
  id: string
  label: string
  type: 'card' | 'category'
  tags?: string[]
}

/**
 * Filter mention candidates by search query.
 */
export function filterMentionCandidates(items: FilterableItem[], query: string): FilterableItem[] {
  if (!query) return items.slice(0, 8)
  const q = query.toLowerCase()
  return items
    .filter(item => item.label.toLowerCase().includes(q) || item.tags?.some(t => t.toLowerCase().includes(q)))
    .slice(0, 8)
}

/**
 * Filter commands by partial input.
 */
export function filterCommands(partial: string): typeof COMMANDS[number][] {
  if (!partial) return [...COMMANDS]
  const q = partial.toLowerCase()
  return COMMANDS.filter(c => c.name.startsWith(q))
}

/**
 * Insert a mention at the cursor position, replacing the @query.
 */
export function insertMention(text: string, cursorPos: number, item: FilterableItem): { text: string; cursor: number } {
  const before = text.slice(0, cursorPos)
  const after = text.slice(cursorPos)
  const lastAt = before.lastIndexOf('@')
  const prefix = before.slice(0, lastAt)
  const ref = item.type === 'category' ? `category:${item.id}` : item.id
  const mention = `@[${item.label}](${ref}) `
  return { text: prefix + mention + after, cursor: prefix.length + mention.length }
}

/**
 * Insert a command at the cursor position, replacing the /query.
 */
export function insertCommand(text: string, cursorPos: number, command: string): { text: string; cursor: number } {
  const before = text.slice(0, cursorPos)
  const after = text.slice(cursorPos)
  const lastSlash = before.lastIndexOf('/')
  const prefix = before.slice(0, lastSlash)
  const cmd = `/${command} `
  return { text: prefix + cmd + after, cursor: prefix.length + cmd.length }
}
