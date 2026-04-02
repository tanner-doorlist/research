import { useState } from 'react'
import type { Card } from '../lib/types'
import { MarkdownRender } from '../components/markdown-render'
import { Spinner } from '../components/spinner'
import { X } from 'lucide-react'
import { useEditCardChat, useApplyCardEdit } from '../hooks/use-api'

interface Props { card: Card; open: boolean; onClose: () => void }

export function EditOverlay({ card, open, onClose }: Props) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)
  const editChatMut = useEditCardChat()
  const applyEditMut = useApplyCardEdit()

  if (!open) return null

  const sendChat = async () => {
    const text = input.trim(); if (!text) return; setInput('')
    const newMsgs = [...messages, { role: 'user' as const, content: text }]
    setMessages(newMsgs)
    try {
      const reply = await editChatMut.mutateAsync({ messages: newMsgs, card })
      setMessages([...newMsgs, { role: 'assistant', content: reply }])
      const m = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (m) { try { const j = JSON.parse(m[1].trim()); if (j.front) setFront(j.front); if (j.back) setBack(j.back) } catch {} }
    } catch (err: unknown) {
      setMessages([...newMsgs, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'failed'}` }])
    }
  }

  const accept = async () => {
    const r = await applyEditMut.mutateAsync({ cardId: card.id, front, back })
    if (!r.ok) alert('Could not save card'); else onClose()
  }

  const inputCls = "flex-1 bg-white/[0.05] border border-glass-border rounded-[var(--radius-md)] text-text-primary text-[12px] px-[var(--spacing-gap-lg)] py-[var(--spacing-gap-sm)] outline-none"
  const textareaCls = "w-full bg-white/[0.05] border border-glass-border rounded-[var(--radius-md)] text-text-primary text-[12px] p-[var(--spacing-gap)] resize-none outline-none leading-relaxed focus:border-accent focus:bg-accent/[0.06]"

  return (
    <div className="absolute inset-0 z-50 bg-[rgba(12,12,16,0.75)] backdrop-blur-[12px] p-[var(--spacing-x)] flex flex-col gap-[var(--spacing-gap)] min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[13px] font-semibold">Edit with AI</span>
        <button onClick={onClose}
          className="w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer bg-white/[0.06] text-text-dim flex items-center justify-center hover:bg-white/[0.13] hover:text-text-primary">
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-[80px] max-h-[180px] overflow-y-auto flex flex-col gap-[var(--spacing-gap-sm)] p-[var(--spacing-gap)] rounded-[var(--radius-md)] bg-black/20 no-drag">
        {messages.length === 0 && <div className="text-[11px] text-text-dim p-[var(--spacing-gap-sm)]">Describe what you want changed, or ask for a sharper question and answer.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`text-[11px] leading-relaxed p-[var(--spacing-gap)] px-[var(--spacing-gap-lg)] rounded-[var(--radius-md)] max-w-[95%] break-words ${
            m.role === 'user' ? 'self-end bg-accent text-white' : 'self-start bg-white/[0.06] border border-glass-border'
          }`}>
            {m.role === 'user' ? m.content : <MarkdownRender content={m.content} />}
          </div>
        ))}
      </div>

      <div className="flex gap-[var(--spacing-gap-sm)] no-drag">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendChat())}
          placeholder="Ask how to improve this card..." className={inputCls} />
        <button onClick={sendChat}
          className="w-8 h-8 border-none rounded-[var(--radius-md)] bg-accent text-white cursor-pointer shrink-0 text-sm flex items-center justify-center">↑</button>
      </div>

      {editChatMut.isPending && <div className="flex items-center justify-center gap-[var(--spacing-gap)] text-[12px] text-text-dim"><Spinner /> Thinking...</div>}

      <div className="flex flex-col gap-[var(--spacing-gap-sm)] shrink-0">
        <span className="text-[10px] font-semibold text-text-dimmer uppercase tracking-wider">Draft question / answer</span>
        <textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} className={textareaCls} />
        <textarea value={back} onChange={(e) => setBack(e.target.value)} rows={3} className={textareaCls} />
        <div className="flex gap-[var(--spacing-gap-sm)]">
          <button onClick={onClose} className="flex-1 h-8 border-none rounded-[var(--radius-md)] cursor-pointer text-[12px] font-medium bg-white/[0.06] text-text-dim active:opacity-80">Discard</button>
          <button onClick={accept} className="flex-1 h-8 border-none rounded-[var(--radius-md)] cursor-pointer text-[12px] font-medium bg-accent text-white active:opacity-80">Save to card</button>
        </div>
      </div>
    </div>
  )
}
