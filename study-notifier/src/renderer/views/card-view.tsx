import { useState, useRef, useEffect, useCallback } from 'react'
import type { Card, Stats, CatalogItem, ConversationMessage, ConversationSession } from '../lib/types'
import { MarkdownRender } from '../components/markdown-render'
import { CardTags } from '../components/card-tags'
import { Spinner } from '../components/spinner'
import { Menu, Settings, Pencil, BookOpen, BarChart3, FileText, Trash2, X, MessageCircle, Flag, ArrowLeft } from 'lucide-react'
import {
  parseMentions, getActiveMention, getActiveSlash,
  filterMentionCandidates, filterCommands, insertMention, insertCommand,
  getPlainAnswer, type FilterableItem, type CommandName, COMMANDS,
} from '../lib/prompt-parser'
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'

interface Props { card: Card; stats: Stats; sessionDone: number; sessionTotal: number }

export function CardView({ card, stats, sessionDone, sessionTotal }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [undoToast, setUndoToast] = useState<{ token: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  // Prompt state
  const [input, setInput] = useState('')
  const [evaluating, setEvaluating] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [lastScore, setLastScore] = useState<number | null>(null) // track AI score for override
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  // Conversation state
  const [pastSessions, setPastSessions] = useState<ConversationSession[]>([])
  const [thread, setThread] = useState<ConversationMessage[]>([])
  const [viewingSession, setViewingSession] = useState<ConversationSession | null>(null)
  const [conversationsOpen, setConversationsOpen] = useState(false)
  const [conversationsIdx, setConversationsIdx] = useState(0)
  const conversationsRef = useRef<HTMLDivElement>(null)

  // Popover state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [popoverIdx, setPopoverIdx] = useState(0)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const catalogLoaded = useRef(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Reset on card change
  const [prevCardId, setPrevCardId] = useState(card.id)
  if (card.id !== prevCardId) {
    setPrevCardId(card.id)
    setInput(''); setRevealed(false); setEvaluating(false); setLastScore(null)
    setMenuOpen(false); setDetailOpen(false); setEditOpen(false); setConfirmDelete(false)
    setMentionQuery(null); setSlashQuery(null)
    setThread([]); setPastSessions([]); setViewingSession(null); setConversationsOpen(false)
  }

  // Load catalog once per mount (not per card change) — catalog is only needed for @mentions
  useEffect(() => {
    if (!catalogLoaded.current) {
      window.api.getCatalog().then(c => {
        setCatalog(c)
        catalogLoaded.current = true
      })
    }
  }, [])

  // Load existing sessions on card change — start with clean thread
  useEffect(() => {
    window.api.getSessions(card.id).then(sessions => {
      setPastSessions(sessions)
    })
  }, [card.id])

  // Auto-scroll thread (also when spinner appears)
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length, evaluating])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  // Close conversations popover on outside click
  useEffect(() => {
    if (!conversationsOpen) return
    const handler = (e: MouseEvent) => { if (conversationsRef.current && !conversationsRef.current.contains(e.target as Node)) setConversationsOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [conversationsOpen])

  // Build mention candidates from catalog
  const mentionItems: FilterableItem[] = (() => {
    const items: FilterableItem[] = []
    const tags = new Set<string>()
    catalog.forEach(c => {
      if (c.id !== card.id) {
        items.push({ id: c.id, label: c.front.slice(0, 60), type: 'card', tags: c.tags })
      }
      c.tags?.forEach(t => { if (t && t !== 'concept') tags.add(t) })
    })
    const catItems: FilterableItem[] = [...tags].sort().map(t => ({ id: t, label: `#${t}`, type: 'category' }))
    return [...catItems, ...items]
  })()

  const filteredMentions = mentionQuery !== null ? filterMentionCandidates(mentionItems, mentionQuery) : []
  const filteredCommands = slashQuery !== null ? filterCommands(slashQuery) : []
  const popoverOpen = filteredMentions.length > 0 || filteredCommands.length > 0
  const popoverItems = mentionQuery !== null ? filteredMentions : filteredCommands

  // Handle input changes — detect @ and / triggers
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setInput(val)

    const mention = getActiveMention(val, cursor)
    const slash = getActiveSlash(val, cursor)
    setMentionQuery(mention)
    setSlashQuery(mention !== null ? null : slash)
    setPopoverIdx(0)
  }

  // Execute a / command
  const executeCommand = useCallback(async (cmd: CommandName, rawInput?: string) => {
    setSlashQuery(null)
    setInput('')
    switch (cmd) {
      case 'edit': setEditOpen(true); break
      case 'skip': window.api.answer(card.id, false); break
      case 'next': window.api.answer(card.id, lastScore !== null ? lastScore >= 1 : false); break
      case 'score': {
        // Parse score from input: /score 0, /score 1, /score 2
        const match = rawInput?.match(/\/score\s+([012])/)
        if (match) {
          const newScore = parseInt(match[1])
          const newCorrect = newScore >= 1
          if (lastScore !== null) {
            const wasCorrect = lastScore >= 1
            await window.api.overrideAnswer(card.id, wasCorrect, newCorrect)
          } else {
            await window.api.recordAnswer(card.id, newCorrect)
          }
          setLastScore(newScore)
          const label = ['Incorrect', 'Partial', 'Correct'][newScore]
          setThread(prev => [...prev,
            { role: 'user', content: `/score ${newScore}`, ts: Date.now() },
            { role: 'assistant', content: `Score overridden to **${label}** (${newScore}/2).`, ts: Date.now(), score: newScore },
          ])
        } else {
          // No score value — prompt user
          setThread(prev => [...prev,
            { role: 'user', content: rawInput || '/score', ts: Date.now() },
            { role: 'assistant', content: 'Usage: `/score 0` (incorrect), `/score 1` (partial), `/score 2` (correct)', ts: Date.now() },
          ])
        }
        break
      }
      case 'conversations': setConversationsOpen(true); setConversationsIdx(0); break
      case 'flag': await window.api.flagCard(card.id); break
      case 'delete': setConfirmDelete(true); break
      case 'category': setDetailOpen(true); break
      case 'merge': break
    }
  }, [card.id, lastScore])

  // Select a popover item
  const selectPopoverItem = useCallback((idx: number) => {
    const ta = inputRef.current
    if (!ta) return
    const cursor = ta.selectionStart ?? input.length

    if (mentionQuery !== null && filteredMentions[idx]) {
      const item = filteredMentions[idx]
      const result = insertMention(input, cursor, item)
      setInput(result.text)
      setMentionQuery(null)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = result.cursor; ta.focus() }, 0)
    } else if (slashQuery !== null && filteredCommands[idx]) {
      const cmd = filteredCommands[idx]
      if (cmd.name === 'score') {
        // Insert /score and let user type the value
        setInput('/score ')
        setSlashQuery(null)
        setTimeout(() => { if (ta) { ta.selectionStart = ta.selectionEnd = 7; ta.focus() } }, 0)
      } else {
        executeCommand(cmd.name as CommandName)
      }
    }
  }, [input, mentionQuery, slashQuery, filteredMentions, filteredCommands, executeCommand])

  // Keyboard nav for popover
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (conversationsOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setConversationsIdx(i => Math.min(i + 1, pastSessions.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setConversationsIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); if (pastSessions[conversationsIdx]) { setViewingSession(pastSessions[conversationsIdx]); setConversationsOpen(false) } }
      else if (e.key === 'Escape') { e.preventDefault(); setConversationsOpen(false) }
      return
    }
    if (popoverOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPopoverIdx(i => Math.min(i + 1, popoverItems.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setPopoverIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectPopoverItem(popoverIdx) }
      else if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); setSlashQuery(null) }
      return
    }
    if (viewingSession && e.key === 'Escape') {
      e.preventDefault(); setViewingSession(null); return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitMessage()
    }
  }

  // Submit message (first answer or follow-up)
  const submitMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    // Handle /score and /next typed directly (without popover selection)
    if (/^\/score\b/.test(trimmed)) {
      executeCommand('score' as CommandName, trimmed)
      return
    }
    if (/^\/next\b/.test(trimmed)) {
      executeCommand('next' as CommandName)
      return
    }
    if (/^\/skip\b/.test(trimmed)) {
      executeCommand('skip' as CommandName)
      return
    }
    if (/^\/conversations?\b/.test(trimmed)) {
      executeCommand('conversations' as CommandName)
      return
    }

    const plain = getPlainAnswer(input)
    if (!plain && !trimmed) return

    const isFollowUp = revealed
    const userText = trimmed

    // Start a new session if this is a fresh answer (not a follow-up)
    if (!isFollowUp && thread.length === 0) {
      await window.api.startSession(card.id)
    }

    // Clear input and add user message to thread immediately
    setInput('')
    setThread(prev => [...prev, { role: 'user', content: userText, ts: Date.now() }])
    setEvaluating(true)

    // Extract referenced card IDs
    const mentions = parseMentions(userText)
    const refCardIds = mentions.filter(m => m.type === 'card').map(m => m.id)

    try {
      const r = await window.api.evaluateAnswer(card.id, plain, refCardIds, isFollowUp)
      if (r.ok && r.feedback) {
        const aiMsg: ConversationMessage = {
          role: 'assistant',
          content: r.score !== undefined && r.score >= 0
            ? `**${['Incorrect', 'Partial', 'Correct'][r.score]}** — ${r.feedback}`
            : r.feedback,
          ts: Date.now(),
          score: r.score,
        }
        setThread(prev => [...prev, aiMsg])
        setRevealed(true)

        // Auto-record AI score (spaced repetition update)
        if (r.score !== undefined && r.score >= 0 && lastScore === null) {
          setLastScore(r.score)
          await window.api.recordAnswer(card.id, r.score >= 1)
        }
      } else if (!r.ok) {
        setThread(prev => [...prev, { role: 'assistant', content: `Error: ${r.error || 'Unknown error'}`, ts: Date.now() }])
      }
    } catch (e: any) {
      setThread(prev => [...prev, { role: 'assistant', content: `Error: ${e.message || e}`, ts: Date.now() }])
    } finally { setEvaluating(false) }

    // Focus back on input
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden no-drag">
      {/* Top bar */}
      <div className="flex items-center px-[var(--spacing-x)] h-9 shrink-0 drag-region">
        <button onClick={() => window.api.openCatalog()}
          className="w-7 h-7 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-text-tertiary hover:bg-surface hover:text-text-secondary transition-colors no-drag">
          <ArrowLeft size={14} />
        </button>
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
                <MenuRow icon={<Flag size={13} />} label="Bad card" className="text-warning hover:!text-warning" onClick={async () => {
                  setMenuOpen(false); await window.api.flagCard(card.id)
                }} />
                <MenuRow icon={<Trash2 size={13} />} label="Delete" className="text-danger hover:!text-danger" onClick={() => {
                  setMenuOpen(false); setConfirmDelete(true)
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

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle>Delete this card?</DialogTitle>
          <DialogDescription>This will remove the card from your study deck. You'll have 10 seconds to undo.</DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <DialogClose asChild>
              <button className="h-7 px-3 border border-border rounded-[var(--radius-md)] bg-transparent text-text-secondary text-[12px] font-medium cursor-pointer hover:bg-surface transition-colors">
                Cancel
              </button>
            </DialogClose>
            <button onClick={async () => {
              setConfirmDelete(false)
              const result = await window.api.deleteCard(card.id)
              if (result.ok && result.undoToken) {
                const timer = setTimeout(() => setUndoToast(null), 10000)
                setUndoToast({ token: result.undoToken, timer })
              }
            }}
              className="h-7 px-3 border-none rounded-[var(--radius-md)] bg-danger text-white text-[12px] font-medium cursor-pointer hover:brightness-110 transition-all">
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Main content area — question + conversation thread */}
      <div className="flex-1 px-[var(--spacing-x)] py-[var(--spacing-y)] flex flex-col overflow-y-auto min-h-0">
        {/* Viewing past session banner */}
        {viewingSession && (
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-surface border border-border shrink-0 animate-fade-up">
            <span className="text-[11px] text-text-tertiary flex-1">
              Session from {new Date(viewingSession.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              {viewingSession.score !== null && (
                <span className={`ml-2 font-medium ${viewingSession.score === 0 ? 'text-danger' : viewingSession.score === 1 ? 'text-warning' : 'text-success'}`}>
                  {['✗ Incorrect', '~ Partial', '✓ Correct'][viewingSession.score]}
                </span>
              )}
            </span>
            <button onClick={() => setViewingSession(null)}
              className="text-[11px] text-accent font-medium bg-transparent border-none cursor-pointer hover:text-accent/80 transition-colors">
              Back
            </button>
          </div>
        )}

        {/* Question */}
        <div className="text-[15px] leading-[1.6] font-normal shrink-0">
          <MarkdownRender content={card.front} />
        </div>

        {/* Conversation thread — either viewing a past session or current */}
        {(() => {
          const displayThread = viewingSession ? viewingSession.messages : thread
          return displayThread.length > 0 && (
            <div className={`flex flex-col gap-2 mt-3 ${viewingSession ? 'opacity-70' : ''}`}>
              {displayThread.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-[var(--radius-lg)] text-[12px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-accent/15 text-text-primary rounded-br-[4px]'
                      : msg.score === 0 ? 'bg-danger/[0.08] text-text-secondary border border-danger/15 rounded-bl-[4px]'
                      : msg.score === 1 ? 'bg-warning/[0.08] text-text-secondary border border-warning/15 rounded-bl-[4px]'
                      : msg.score === 2 ? 'bg-success/[0.08] text-text-secondary border border-success/15 rounded-bl-[4px]'
                      : 'bg-surface text-text-secondary border border-border rounded-bl-[4px]'
                  }`}>
                    <MarkdownRender content={msg.content} />
                  </div>
                </div>
              ))}
              {!viewingSession && evaluating && (
                <div className="flex justify-start">
                  <div className="px-3 py-2 rounded-[var(--radius-lg)] rounded-bl-[4px] bg-surface border border-border">
                    <Spinner />
                  </div>
                </div>
              )}
              <div ref={threadEndRef} />
            </div>
          )
        })()}

        <div className="flex-1 min-h-3" />

        {/* Answer reveal (after first eval) */}
        {revealed && !viewingSession && (
          <div className="flex flex-col gap-3 animate-fade-up shrink-0">
            <div className="w-full h-px bg-border" />
            <div className="text-[13px] leading-[1.65] text-text-secondary">
              <MarkdownRender content={card.back} />
            </div>
          </div>
        )}
      </div>

      {/* Prompt input — always visible */}
      <div className="px-[var(--spacing-x)] pb-2 pt-1 shrink-0 border-t border-border">
        <div className="relative">
          {/* Conversations popover */}
          {conversationsOpen && (
            <div ref={conversationsRef}
              className="absolute bottom-full left-0 right-0 mb-1 bg-[rgba(30,30,34,0.97)] backdrop-blur-xl border border-border rounded-[var(--radius-lg)] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.4)] z-50 max-h-64 overflow-y-auto">
              <div className="px-3 py-1.5 border-b border-border">
                <span className="text-[11px] font-semibold text-text-secondary">Past conversations</span>
                <span className="text-[10px] text-text-tertiary ml-2">({pastSessions.length})</span>
              </div>
              {pastSessions.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-text-tertiary text-center">No past conversations for this card.</div>
              ) : (
                [...pastSessions].reverse().map((session, i) => (
                  <button key={session.id} onClick={() => { setViewingSession(session); setConversationsOpen(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 border-none cursor-pointer text-left transition-colors ${
                      i === conversationsIdx ? 'bg-accent/15 text-text-primary' : 'bg-transparent text-text-secondary hover:bg-surface'
                    }`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      session.score === 0 ? 'bg-danger' : session.score === 1 ? 'bg-warning' : session.score === 2 ? 'bg-success' : 'bg-text-tertiary'
                    }`} />
                    <span className="text-[12px]">
                      {new Date(session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span className="text-[10px] text-text-tertiary ml-1">
                      {session.messages.length} msg{session.messages.length !== 1 ? 's' : ''}
                    </span>
                    {session.score !== null && (
                      <span className={`text-[10px] font-medium ml-auto ${
                        session.score === 0 ? 'text-danger' : session.score === 1 ? 'text-warning' : 'text-success'
                      }`}>
                        {['✗', '~', '✓'][session.score]}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Mention/command popover */}
          {popoverOpen && (
            <div ref={popoverRef}
              className="absolute bottom-full left-0 right-0 mb-1 bg-[rgba(30,30,34,0.97)] backdrop-blur-xl border border-border rounded-[var(--radius-lg)] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.4)] z-50 max-h-48 overflow-y-auto">
              {mentionQuery !== null ? (
                filteredMentions.map((item, i) => (
                  <button key={item.id} onClick={() => selectPopoverItem(i)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 border-none cursor-pointer text-left text-[12px] transition-colors ${
                      i === popoverIdx ? 'bg-accent/15 text-text-primary' : 'bg-transparent text-text-secondary hover:bg-surface'
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.type === 'category' ? 'bg-warning' : 'bg-accent/50'}`} />
                    <span className="truncate">{item.label}</span>
                    {item.type === 'category' && <span className="text-[10px] text-text-tertiary ml-auto">category</span>}
                  </button>
                ))
              ) : (
                filteredCommands.map((cmd, i) => (
                  <button key={cmd.name} onClick={() => selectPopoverItem(i)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 border-none cursor-pointer text-left text-[12px] transition-colors ${
                      i === popoverIdx ? 'bg-accent/15 text-text-primary' : 'bg-transparent text-text-secondary hover:bg-surface'
                    }`}>
                    <span className="text-accent font-mono">/{cmd.name}</span>
                    <span className="text-text-tertiary text-[11px] ml-auto">{cmd.description}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="flex items-end gap-1.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={viewingSession ? "Viewing past session — press Esc to go back" : revealed ? "Follow up, /score, /next..." : "Type your answer..."}
              rows={2}
              disabled={evaluating || !!viewingSession}
              className="flex-1 bg-surface border border-border rounded-[var(--radius-md)] text-text-primary text-[13px] px-3 py-2 outline-none resize-none min-h-[44px] max-h-[120px] leading-relaxed focus:border-accent/40 transition-colors disabled:opacity-50"
            />
            <button onClick={submitMessage} disabled={evaluating || !input.trim() || !!viewingSession}
              className="h-[44px] w-9 border-none rounded-[var(--radius-md)] bg-accent text-white cursor-pointer flex items-center justify-center shrink-0 hover:brightness-110 disabled:opacity-30 transition-all">
              {evaluating ? <Spinner /> : '↑'}
            </button>
          </div>

          <div className="flex items-center gap-3 mt-1 px-1">
            <span className="text-[10px] text-text-tertiary">
              <kbd className="text-text-tertiary/70">@</kbd> mention
            </span>
            <span className="text-[10px] text-text-tertiary">
              <kbd className="text-text-tertiary/70">/</kbd> command
            </span>
            {lastScore !== null && (
              <span className={`text-[10px] font-medium ${lastScore === 0 ? 'text-danger' : lastScore === 1 ? 'text-warning' : 'text-success'}`}>
                {['✗', '~', '✓'][lastScore]} scored
              </span>
            )}
            <span className="text-[10px] text-text-tertiary ml-auto">
              <kbd className="text-text-tertiary/70">Enter</kbd> submit
            </span>
          </div>
        </div>
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

      {/* Undo toast */}
      {undoToast && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 px-3 py-2 bg-[rgba(30,30,34,0.95)] backdrop-blur-xl border border-border rounded-[var(--radius-md)] animate-fade-up z-40">
          <span className="text-[12px] text-text-secondary flex-1">Card deleted</span>
          <button onClick={async () => {
            await window.api.undoDelete(undoToast.token)
            clearTimeout(undoToast.timer)
            setUndoToast(null)
          }}
            className="text-[12px] font-semibold text-accent cursor-pointer bg-transparent border-none hover:text-accent/80 transition-colors">
            Undo
          </button>
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
