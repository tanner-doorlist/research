import { useState, useEffect, useRef } from 'react'
import type { Card } from '../lib/types'
import { MarkdownRender } from '../components/markdown-render'
import { stripMarkdownPreview } from '../lib/markdown'
import { Spinner } from '../components/spinner'

export function ChatView({ card }: { card: Card }) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return; initialized.current = true
    window.api.chatSend([{ role: 'user', content: "Let's dig into this. Give me a brief framing of the core concept, then ask me one probing question to check my understanding." }], card)
      .then((r) => { setMessages([{ role: 'assistant', content: r }]); setLoading(false) })
      .catch(() => { setMessages([{ role: 'assistant', content: 'Set ANTHROPIC_API_KEY to enable chat.' }]); setLoading(false) })
  }, [card])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages, loading])

  const send = async () => {
    const text = input.trim(); if (!text) return; setInput('')
    const h = [...messages, { role: 'user' as const, content: text }]
    setMessages(h); setLoading(true)
    try { const r = await window.api.chatSend(h, card); setMessages([...h, { role: 'assistant', content: r }]) }
    catch { setMessages([...h, { role: 'assistant', content: 'Error — check API key.' }]) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden no-drag">
      <div className="px-[var(--spacing-x)] py-2 border-b border-border shrink-0">
        <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-px">Discussing</div>
        <div className="text-[12px] text-text-secondary leading-snug line-clamp-1">{stripMarkdownPreview(card.front)}</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-[var(--spacing-x)] py-3 flex flex-col gap-2">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[88%] px-3 py-2 rounded-[var(--radius-lg)] text-[13px] leading-relaxed ${
            m.role === 'user'
              ? 'self-end bg-accent text-white rounded-br-[var(--radius-sm)]'
              : 'self-start bg-surface border border-border text-text-secondary rounded-bl-[var(--radius-sm)]'
          }`}>
            {m.role === 'user' ? m.content : <MarkdownRender content={m.content} />}
          </div>
        ))}
        {loading && <div className="self-start flex items-center gap-2 text-text-tertiary text-[12px] italic px-3 py-2"><Spinner /> Thinking...</div>}
      </div>

      <div className="flex gap-1.5 px-[var(--spacing-x)] py-2 shrink-0 border-t border-border">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Ask a follow-up..."
          className="flex-1 bg-surface border border-transparent rounded-[var(--radius-md)] text-text-primary text-[12px] px-2.5 py-1.5 outline-none h-7 focus:border-accent/30 transition-colors" />
        <button onClick={send}
          className="w-7 h-7 border-none rounded-[var(--radius-md)] bg-accent text-white text-sm cursor-pointer shrink-0 flex items-center justify-center active:scale-95 transition-transform">↑</button>
      </div>
    </div>
  )
}
