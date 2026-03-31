import { useState } from 'react'
import type { Card } from '../lib/types'

interface Props { card: Card; onTagsChanged?: () => void }

export function CardTags({ card, onTagsChanged }: Props) {
  const [adding, setAdding] = useState(false)
  const [tagInput, setTagInput] = useState('')

  const removeTag = async (tag: string) => {
    await window.api.setCardTags(card.id, card.tags.filter((t) => t !== tag))
    onTagsChanged?.()
  }

  const addTag = async () => {
    const tag = tagInput.trim().toLowerCase()
    if (!tag || card.tags.includes(tag)) return
    await window.api.setCardTags(card.id, [...card.tags, tag])
    setTagInput(''); setAdding(false); onTagsChanged?.()
  }

  const visibleTags = card.tags.filter((t) => t !== 'concept')

  return (
    <div className="flex gap-1 items-center flex-wrap mb-1 shrink-0 no-drag">
      {visibleTags.map((tag) => (
        <button key={tag} onClick={() => removeTag(tag)}
          className="h-[18px] px-1.5 rounded-[var(--radius-sm)] bg-accent/10 text-accent/70 text-[10px] font-medium cursor-pointer border-none hover:bg-danger/15 hover:text-danger transition-colors">
          {tag}
        </button>
      ))}
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="h-[18px] px-1.5 rounded-[var(--radius-sm)] bg-transparent text-text-tertiary text-[10px] font-medium cursor-pointer border border-border hover:bg-surface transition-colors">
          +
        </button>
      ) : (
        <div className="flex items-center gap-1 w-full mt-0.5">
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="tag" autoFocus
            className="h-5 px-1.5 rounded-[var(--radius-sm)] bg-surface border border-border text-text-primary text-[10px] outline-none min-w-[60px] flex-1 focus:border-accent/40" />
          <button onClick={addTag} className="h-5 px-2 rounded-[var(--radius-sm)] border-none bg-accent text-white text-[10px] font-medium cursor-pointer">Add</button>
        </div>
      )}
    </div>
  )
}
