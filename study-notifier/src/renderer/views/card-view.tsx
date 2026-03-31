import { useState, useRef, useEffect } from 'react'
import type { Card, Stats } from '../lib/types'
import { MarkdownRender } from '../components/markdown-render'
import { CardTags } from '../components/card-tags'
import { Spinner } from '../components/spinner'
import { Menu, Settings, Pencil, BookOpen, BarChart3, FileText, Trash2, X, MessageCircle } from 'lucide-react'

interface Props { card: Card; stats: Stats; sessionDone: number; sessionTotal: number }

export function CardView({ card, stats, sessionDone, sessionTotal }: Props) {
  const [revealed, setRevealed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [typeAnswerOpen, setTypeAnswerOpen] = useState(false)
  const [typedAnswer, setTypedAnswer] = useState('')
  const [evalResult, setEvalResult] = useState<{ score: number; feedback: string } | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const [prevCardId, setPrevCardId] = useState(card.id)
  if (card.id !== prevCardId) {
    setPrevCardId(card.id)
    setRevealed(false); setMenuOpen(false); setDetailOpen(false); setEditOpen(false)
    setTypeAnswerOpen(false); setTypedAnswer(''); setEvalResult(null)
  }

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const vote = (correct: boolean) => window.api.answer(card.id, correct)
  const evaluate = async () => {
    if (!typedAnswer.trim()) return; setEvaluating(true)
    try { const r = await window.api.evaluateAnswer(card.id, typedAnswer); if (r.ok && r.score !== undefined && r.feedback) setEvalResult({ score: r.score, feedback: r.feedback }) }
    finally { setEvaluating(false) }
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden no-drag">
      {/* Top bar */}
      <div className="flex items-center px-[var(--spacing-x)] h-9 shrink-0 drag-region">
        <div className="flex-1" />
        <div className="relative no-drag" ref={menuRef}>
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-text-tertiary hover:bg-surface hover:text-text-secondary transition-colors">
            {menuOpen ? <X size={14} /> : <Menu size={14} />}
          </button>

          {menuOpen && (
            <div className="absolute top-8 right-0 w-44 bg-[rgba(30,30,34,0.97)] backdrop-blur-xl border border-border rounded-[var(--radius-lg)] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.4)] z-50 animate-fade-up">
              <div className="flex gap-1 px-2 py-1.5 border-b border-border">
                <MenuIcon icon={<Settings size={13} />} tip="Details" onClick={() => { setDetailOpen(!detailOpen); setMenuOpen(false) }} />
                <MenuIcon icon={<Pencil size={13} />} tip="Edit" onClick={() => { setEditOpen(true); setMenuOpen(false) }} />
                <MenuIcon icon={<MessageCircle size={13} />} tip="Chat" onClick={() => { window.api.openChat(card); setMenuOpen(false) }} />
              </div>
              <div className="py-0.5">
                <MenuRow icon={<BookOpen size={13} />} label="Catalog" onClick={() => { window.api.openCatalog(); setMenuOpen(false) }} />
                <MenuRow icon={<FileText size={13} />} label="Logs" onClick={() => { window.api.openKnowledge(); setMenuOpen(false) }} />
                <MenuRow icon={<BarChart3 size={13} />} label="Stats" onClick={() => { window.api.openAnalytics(); setMenuOpen(false) }} />
              </div>
              <div className="border-t border-border py-0.5">
                <MenuRow icon={<Trash2 size={13} />} label="Delete" className="text-danger hover:!text-danger" onClick={async () => {
                  setMenuOpen(false); if (confirm('Delete this card?')) await window.api.deleteCard(card.id)
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {detailOpen && (
        <div className="px-[var(--spacing-x)] py-1.5 shrink-0 border-b border-border animate-fade-up">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full ${card.type === 'concept' ? 'bg-warning' : 'bg-accent'}`} />
            <span className="text-[11px] text-text-secondary">{card.type === 'concept' ? 'Concept' : 'Q&A'}</span>
            <span className="text-[11px] text-text-tertiary ml-auto">{stats.due} due · {stats.totalGot || 0}✓ {stats.totalMiss || 0}✗</span>
          </div>
          <CardTags card={card} />
        </div>
      )}

      {/* Question */}
      <div className="flex-1 px-[var(--spacing-x)] py-[var(--spacing-y)] flex flex-col overflow-y-auto">
        <div className="text-[15px] leading-[1.6] font-normal">
          <MarkdownRender content={card.front} />
        </div>

        {!revealed && <div className="flex-1 min-h-4" />}

        {/* Type answer */}
        {card.type === 'qa' && !revealed && (
          <>
            {!typeAnswerOpen ? (
              <button onClick={() => setTypeAnswerOpen(true)}
                className="w-full h-7 border border-border rounded-[var(--radius-md)] bg-transparent text-text-tertiary text-[12px] font-medium cursor-pointer mb-1.5 hover:bg-surface hover:text-text-secondary transition-colors">
                Type answer
              </button>
            ) : (
              <div className="flex flex-col gap-1.5 mb-2 no-drag">
                <textarea value={typedAnswer} onChange={(e) => setTypedAnswer(e.target.value)} placeholder="Your answer..." rows={3}
                  className="w-full bg-surface border border-border rounded-[var(--radius-md)] text-text-primary text-[13px] px-3 py-2 outline-none resize-none min-h-14 leading-relaxed focus:border-accent/40 transition-colors" />
                <button onClick={evaluate} disabled={evaluating}
                  className="w-full h-7 border border-accent/25 rounded-[var(--radius-md)] bg-accent-subtle text-accent text-[12px] font-medium cursor-pointer hover:bg-accent/20 disabled:opacity-40 transition-colors">
                  {evaluating ? <Spinner className="mx-auto" /> : 'Evaluate'}
                </button>
                {evalResult && (
                  <div className={`px-3 py-2 rounded-[var(--radius-md)] text-[12px] leading-relaxed bg-surface border border-border ${
                    evalResult.score === 0 ? 'text-danger' : evalResult.score === 1 ? 'text-warning' : 'text-success'
                  }`}>
                    <strong>{['Incorrect', 'Partial', 'Correct'][evalResult.score]}:</strong> {evalResult.feedback}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Reveal */}
        {!revealed && (
          <button onClick={() => setRevealed(true)}
            className="w-full h-9 border border-border rounded-[var(--radius-md)] bg-surface text-text-primary text-[13px] font-medium cursor-pointer hover:bg-surface-hover active:scale-[0.99] transition-all">
            Show Answer
          </button>
        )}

        {/* Answer */}
        {revealed && (
          <div className="flex flex-col gap-3 animate-fade-up mt-3">
            <div className="w-full h-px bg-border" />
            <div className="text-[13px] leading-[1.65] text-text-secondary">
              <MarkdownRender content={card.back} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => vote(false)}
                className="flex-1 h-9 border-none rounded-[var(--radius-md)] cursor-pointer text-[13px] font-semibold bg-danger/90 text-white hover:bg-danger active:scale-[0.98] transition-all">
                Missed it
              </button>
              <button onClick={() => vote(true)}
                className="flex-1 h-9 border-none rounded-[var(--radius-md)] cursor-pointer text-[13px] font-semibold bg-success/90 text-white hover:bg-success active:scale-[0.98] transition-all">
                Got it
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Session dots */}
      {sessionTotal > 1 && (
        <div className="flex items-center justify-center gap-1 px-[var(--spacing-x)] py-1.5 shrink-0">
          {Array.from({ length: sessionTotal }, (_, i) => (
            <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${
              i < sessionDone ? 'bg-success/60' : i === sessionDone ? 'bg-accent' : 'bg-white/10'
            }`} />
          ))}
        </div>
      )}

      {editOpen && <EditInline card={card} onClose={() => setEditOpen(false)} />}
    </div>
  )
}

function MenuIcon({ icon, tip, onClick }: { icon: React.ReactNode; tip: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={tip}
      className="w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors">
      {icon}
    </button>
  )
}

function MenuRow({ icon, label, onClick, className }: { icon: React.ReactNode; label: string; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 border-none bg-transparent cursor-pointer text-[12px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors ${className || ''}`}>
      {icon}{label}
    </button>
  )
}

function EditInline({ card, onClose }: { card: Card; onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)

  const sendChat = async () => {
    const text = input.trim(); if (!text) return; setInput('')
    const newMsgs = [...messages, { role: 'user' as const, content: text }]
    setMessages(newMsgs); setLoading(true)
    try {
      const reply = await window.api.editCardChat(newMsgs, card)
      setMessages([...newMsgs, { role: 'assistant', content: reply }])
      const m = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (m) { try { const j = JSON.parse(m[1].trim()); if (j.front) setFront(j.front); if (j.back) setBack(j.back) } catch {} }
    } catch (err: unknown) {
      setMessages([...newMsgs, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'failed'}` }])
    } finally { setLoading(false) }
  }

  const accept = async () => {
    const r = await window.api.applyCardEdit(card.id, front, back)
    if (!r.ok) alert('Could not save'); else onClose()
  }

  const ta = "w-full bg-surface border border-border rounded-[var(--radius-md)] text-text-primary text-[12px] p-2 resize-none outline-none leading-relaxed focus:border-accent/40 transition-colors"

  return (
    <div className="absolute inset-0 z-50 bg-[rgba(12,12,16,0.88)] backdrop-blur-xl p-[var(--spacing-x)] flex flex-col gap-2 min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[13px] font-semibold">Edit card</span>
        <button onClick={onClose} className="w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer bg-transparent text-text-tertiary flex items-center justify-center hover:bg-surface hover:text-text-secondary"><X size={14} /></button>
      </div>
      <div className="flex-1 min-h-[60px] max-h-[160px] overflow-y-auto flex flex-col gap-1 p-2 rounded-[var(--radius-md)] bg-black/20 no-drag">
        {messages.length === 0 && <div className="text-[11px] text-text-tertiary p-1">Describe what to change.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`text-[11px] leading-relaxed px-2.5 py-1.5 rounded-[var(--radius-md)] max-w-[95%] break-words ${
            m.role === 'user' ? 'self-end bg-accent text-white' : 'self-start bg-surface border border-border text-text-secondary'
          }`}>{m.content}</div>
        ))}
      </div>
      <div className="flex gap-1.5 no-drag">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendChat())}
          placeholder="Ask how to improve..."
          className="flex-1 bg-surface border border-border rounded-[var(--radius-md)] text-text-primary text-[12px] px-2.5 py-1.5 outline-none focus:border-accent/40 transition-colors" />
        <button onClick={sendChat} className="w-7 h-7 border-none rounded-[var(--radius-md)] bg-accent text-white cursor-pointer shrink-0 text-sm flex items-center justify-center">↑</button>
      </div>
      {loading && <div className="flex items-center justify-center gap-2 text-[12px] text-text-tertiary"><Spinner /> Thinking...</div>}
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">Question</span>
        <textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} className={ta} />
        <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">Answer</span>
        <textarea value={back} onChange={(e) => setBack(e.target.value)} rows={3} className={ta} />
        <div className="flex gap-1.5">
          <button onClick={onClose} className="flex-1 h-7 border border-border rounded-[var(--radius-md)] cursor-pointer text-[12px] font-medium bg-transparent text-text-secondary hover:bg-surface transition-colors">Discard</button>
          <button onClick={accept} className="flex-1 h-7 border-none rounded-[var(--radius-md)] cursor-pointer text-[12px] font-medium bg-accent text-white hover:brightness-110 transition-all">Save</button>
        </div>
      </div>
    </div>
  )
}
