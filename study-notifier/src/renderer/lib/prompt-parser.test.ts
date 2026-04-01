import { describe, it, expect } from 'vitest'
import {
  parseMentions,
  stripMentions,
  getPlainAnswer,
  parseCommand,
  getActiveSlash,
  getActiveMention,
  filterMentionCandidates,
  filterCommands,
  insertMention,
  insertCommand,
  COMMANDS,
  type FilterableItem,
} from './prompt-parser'

describe('parseMentions', () => {
  it('parses card mentions', () => {
    const text = 'relates to @[Flutter rebuild](abc-123) somehow'
    const result = parseMentions(text)
    expect(result).toEqual([{ type: 'card', id: 'abc-123', label: 'Flutter rebuild' }])
  })

  it('parses category mentions', () => {
    const text = 'this is about @[#electron](category:electron)'
    const result = parseMentions(text)
    expect(result).toEqual([{ type: 'category', id: 'electron', label: '#electron' }])
  })

  it('parses multiple mentions', () => {
    const text = '@[card1](id1) and @[#tag](category:tag) together'
    const result = parseMentions(text)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: 'card', id: 'id1', label: 'card1' })
    expect(result[1]).toEqual({ type: 'category', id: 'tag', label: '#tag' })
  })

  it('returns empty for no mentions', () => {
    expect(parseMentions('just plain text')).toEqual([])
  })
})

describe('stripMentions', () => {
  it('replaces mention markup with plain label', () => {
    expect(stripMentions('see @[Flutter rebuild](abc-123) here')).toBe('see @Flutter rebuild here')
  })

  it('handles multiple mentions', () => {
    expect(stripMentions('@[a](1) and @[b](2)')).toBe('@a and @b')
  })

  it('leaves plain text unchanged', () => {
    expect(stripMentions('no mentions')).toBe('no mentions')
  })
})

describe('getPlainAnswer', () => {
  it('strips mentions and commands', () => {
    expect(getPlainAnswer('@[card](id) the answer is X /skip')).toBe('@card the answer is X')
  })

  it('handles plain text', () => {
    expect(getPlainAnswer('the answer is 42')).toBe('the answer is 42')
  })
})

describe('parseCommand', () => {
  it('parses a simple command', () => {
    expect(parseCommand('/edit')).toEqual({ command: 'edit', args: '' })
  })

  it('parses command with args', () => {
    expect(parseCommand('/category electron')).toEqual({ command: 'category', args: 'electron' })
  })

  it('returns null for non-commands', () => {
    expect(parseCommand('just text')).toBeNull()
  })

  it('handles leading whitespace', () => {
    expect(parseCommand('  /skip')).toEqual({ command: 'skip', args: '' })
  })
})

describe('getActiveSlash', () => {
  it('detects slash at start', () => {
    expect(getActiveSlash('/ed', 3)).toBe('ed')
  })

  it('detects slash after space', () => {
    // cursor at pos 7 means slice(0,7) = 'text /s'
    expect(getActiveSlash('text /sk', 8)).toBe('sk')
  })

  it('returns empty string for bare slash', () => {
    expect(getActiveSlash('/', 1)).toBe('')
  })

  it('returns null when no slash', () => {
    expect(getActiveSlash('no slash', 8)).toBeNull()
  })

  it('ignores slash in middle of word', () => {
    expect(getActiveSlash('a/b', 3)).toBeNull()
  })

  it('only looks at text before cursor', () => {
    expect(getActiveSlash('/edit more text', 3)).toBe('ed')
  })
})

describe('getActiveMention', () => {
  it('detects @ at start', () => {
    expect(getActiveMention('@flu', 4)).toBe('flu')
  })

  it('detects @ after space', () => {
    expect(getActiveMention('see @ele', 8)).toBe('ele')
  })

  it('returns empty for bare @', () => {
    expect(getActiveMention('@', 1)).toBe('')
  })

  it('returns null when no @', () => {
    expect(getActiveMention('no at', 5)).toBeNull()
  })

  it('ignores completed mentions', () => {
    expect(getActiveMention('@[done](id) ', 12)).toBeNull()
  })

  it('ignores @ in middle of word', () => {
    expect(getActiveMention('email@test', 10)).toBeNull()
  })
})

describe('filterMentionCandidates', () => {
  const items: FilterableItem[] = [
    { id: '1', label: 'Flutter rebuild issue', type: 'card', tags: ['flutter'] },
    { id: '2', label: 'Electron IPC', type: 'card', tags: ['electron'] },
    { id: 'electron', label: '#electron', type: 'category' },
    { id: 'flutter', label: '#flutter', type: 'category' },
  ]

  it('returns top 8 when query is empty', () => {
    expect(filterMentionCandidates(items, '').length).toBeLessThanOrEqual(8)
  })

  it('filters by label', () => {
    const result = filterMentionCandidates(items, 'flutter')
    expect(result.some(r => r.label.includes('Flutter'))).toBe(true)
    expect(result.some(r => r.label === '#flutter')).toBe(true)
  })

  it('filters by tag', () => {
    const result = filterMentionCandidates(items, 'electron')
    expect(result.some(r => r.id === '2')).toBe(true)
  })

  it('returns empty for no match', () => {
    expect(filterMentionCandidates(items, 'zzzzz')).toEqual([])
  })
})

describe('filterCommands', () => {
  it('returns all commands for empty query', () => {
    expect(filterCommands('').length).toBe(COMMANDS.length)
  })

  it('filters by prefix', () => {
    const result = filterCommands('ed')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('edit')
  })

  it('returns empty for no match', () => {
    expect(filterCommands('zzz')).toEqual([])
  })
})

describe('insertMention', () => {
  it('inserts mention replacing @query', () => {
    const { text, cursor } = insertMention('hello @flu', 10, { id: 'abc', label: 'Flutter rebuild', type: 'card' })
    expect(text).toBe('hello @[Flutter rebuild](abc) ')
    expect(cursor).toBe('hello @[Flutter rebuild](abc) '.length)
  })

  it('preserves text after cursor', () => {
    // cursor at 4: before='@ele', after=' more'. Insert adds trailing space → double space is expected
    const { text } = insertMention('@ele more', 4, { id: 'electron', label: '#electron', type: 'category' })
    expect(text).toBe('@[#electron](category:electron)  more')
  })
})

describe('insertCommand', () => {
  it('inserts command replacing /query', () => {
    const { text, cursor } = insertCommand('/ed', 3, 'edit')
    expect(text).toBe('/edit ')
    expect(cursor).toBe(6)
  })

  it('preserves text after cursor', () => {
    // cursor at 8: before='text /sk', after=' rest'. Insert adds trailing space
    const { text } = insertCommand('text /sk rest', 8, 'skip')
    expect(text).toBe('text /skip  rest')
  })
})
