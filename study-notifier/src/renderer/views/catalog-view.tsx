import { useState, useMemo, useRef, useCallback } from 'react'
import type { CatalogItem, Stats } from '../lib/types'
import { stripMarkdownPreview } from '../lib/markdown'
import { Search, Trash2, Flag, Merge, Tag, X, Check } from 'lucide-react'
import { Spinner } from '../components/spinner'
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'

type FilterMode = 'active' | 'flagged' | 'retired'

interface Props { catalog: CatalogItem[]; stats: Stats }

export function CatalogView({ catalog, stats }: Props) {
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [filterMode, setFilterMode] = useState<FilterMode>('active')
  const [semanticMode, setSemanticMode] = useState(false)
  const [semanticOrder, setSemanticOrder] = useState<string[] | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Multi-select state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmAction, setConfirmAction] = useState<'delete' | 'retag' | null>(null)
  const [retagValue, setRetagValue] = useState('')
  const [merging, setMerging] = useState(false)
  const [toast, setToast] = useState<{ message: string; cardId?: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flaggedCount = useMemo(() => catalog.filter(i => i.flagged).length, [catalog])
  const retiredCount = useMemo(() => catalog.filter(i => i.retired).length, [catalog])

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    catalog.forEach((item) => item.tags?.forEach((t) => { if (t && t !== 'concept') counts.set(t, (counts.get(t) || 0) + 1) }))
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const miscIdx = sorted.findIndex(([t]) => t === 'misc')
    const misc = miscIdx >= 0 ? sorted.splice(miscIdx, 1) : []
    const top7 = sorted.slice(0, 7).map(([t]) => t).sort()
    return [...top7, ...misc.map(([t]) => t)]
  }, [catalog])

  const filtered = useMemo(() => {
    let items = catalog
    if (filterMode === 'active') items = items.filter(i => !i.retired && !i.flagged)
    else if (filterMode === 'flagged') items = items.filter(i => i.flagged)
    else if (filterMode === 'retired') items = items.filter(i => i.retired)
    if (activeTag) items = items.filter((item) => item.tags?.includes(activeTag))
    if (search.trim()) {
      if (semanticMode && semanticOrder) {
        const m = new Map(semanticOrder.map((id, i) => [id, i]))
        items = items.filter((item) => m.has(item.id)).sort((a, b) => (m.get(a.id) ?? 999) - (m.get(b.id) ?? 999))
      } else {
        const q = search.toLowerCase()
        items = items.filter((item) => item.id.toLowerCase().includes(q) || stripMarkdownPreview(item.front).toLowerCase().includes(q) || item.tags?.some((t) => t.toLowerCase().includes(q)))
      }
    }
    return items
  }, [catalog, search, activeTag, filterMode, semanticMode, semanticOrder])

  const looksLikeId = (s: string) => /^[0-9a-f-]{4,}$/i.test(s.trim())

  const onSearch = (value: string) => {
    setSearch(value); setSemanticMode(false); setSemanticOrder(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (value.trim().length >= 3 && !looksLikeId(value)) {
      searchTimer.current = setTimeout(async () => {
        const r = await window.api.semanticSearchCards(value)
        if (r.ok && r.orderedIds) { setSemanticMode(true); setSemanticOrder(r.orderedIds) }
      }, 600)
    }
  }

  const selectMode = selected.size > 0

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    const allIds = new Set(filtered.map(i => i.id))
    setSelected(allIds)
  }, [filtered])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const handleBulkDelete = async () => {
    await window.api.bulkDelete([...selected])
    setSelected(new Set())
    setConfirmAction(null)
  }

  const handleBulkRetag = async () => {
    const tags = retagValue.trim().split(/[\s,]+/).filter(Boolean)
    if (tags.length === 0) return
    await window.api.bulkSetTags([...selected], tags)
    setSelected(new Set())
    setConfirmAction(null)
    setRetagValue('')
  }

  const handleBulkFlag = async () => {
    await window.api.bulkFlag([...selected])
    setSelected(new Set())
  }

  const showToast = (message: string, cardId?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, cardId })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  const handleBulkMerge = async () => {
    const count = selected.size
    setMerging(true)
    try {
      const r = await window.api.bulkMerge([...selected])
      setSelected(new Set())
      if (r.ok) {
        showToast(`Merged ${count} cards → ${r.newCardId?.slice(0, 8) ?? 'new card'}`, r.newCardId)
      } else {
        showToast(`Merge failed: ${r.error || 'unknown error'}`)
      }
    } catch (e) {
      showToast(`Merge failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      setSelected(new Set())
    } finally { setMerging(false) }
  }

  const totalAns = (stats.totalGot || 0) + (stats.totalMiss || 0)
  const acc = totalAns > 0 ? Math.round((stats.totalGot / totalAns) * 100) : 0

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden no-drag">
      {/* Stats */}
      <div className="flex items-center gap-4 px-[var(--spacing-x)] h-8 shrink-0 text-[11px] text-text-tertiary border-b border-border">
        <span><span className="text-text-primary font-medium">{stats.total}</span> cards</span>
        <span><span className="text-text-primary font-medium">{stats.due}</span> due</span>
        <span><span className="text-accent font-medium">{stats.streak}</span> streak</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px]">{acc}%</span>
          <div className="w-12 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-accent/70 rounded-full transition-[width] duration-500" style={{ width: `${acc}%` }} />
          </div>
        </div>
      </div>

      {/* Bulk action toolbar */}
      {selectMode ? (
        <div className="flex items-center gap-1 px-[var(--spacing-x)] h-9 shrink-0 border-b border-accent/20 bg-accent/[0.04] animate-fade-up">
          <button onClick={clearSelection} title="Clear selection"
            className="w-6 h-6 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-text-tertiary hover:bg-surface hover:text-text-secondary transition-colors">
            <X size={13} />
          </button>
          <span className="text-[11px] text-text-secondary font-medium">{selected.size} selected</span>
          <button onClick={selectAll} className="text-[10px] text-accent bg-transparent border-none cursor-pointer hover:text-accent/80 transition-colors ml-1">
            All
          </button>
          <div className="flex-1" />
          {selected.size >= 2 && (
            <button onClick={handleBulkMerge} disabled={merging} title="Merge into one"
              className="w-6 h-6 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-30">
              {merging ? <Spinner /> : <Merge size={13} />}
            </button>
          )}
          <button onClick={() => { setRetagValue(''); setConfirmAction('retag') }} title="Recategorize"
            className="w-6 h-6 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-text-secondary hover:bg-surface hover:text-text-primary transition-colors">
            <Tag size={13} />
          </button>
          <button onClick={handleBulkFlag} title="Flag selected"
            className="w-6 h-6 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-warning hover:bg-warning/10 transition-colors">
            <Flag size={13} />
          </button>
          <button onClick={() => setConfirmAction('delete')} title="Delete selected"
            className="w-6 h-6 border-none rounded-[var(--radius-md)] cursor-pointer flex items-center justify-center bg-transparent text-danger hover:bg-danger/10 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="px-[var(--spacing-x)] py-1.5 shrink-0">
            <div className="flex items-center gap-2 px-2.5 h-7 bg-surface border border-transparent rounded-[var(--radius-md)] transition-all focus-within:border-accent/30 focus-within:bg-accent/[0.04]">
              <Search size={12} className="text-text-tertiary shrink-0" />
              <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search..."
                className="flex-1 min-w-0 h-full p-0 border-none bg-transparent text-text-primary text-[12px] outline-none placeholder:text-text-tertiary" />
              {semanticMode && <span className="text-[9px] text-accent font-medium tracking-wide uppercase shrink-0">AI</span>}
            </div>
          </div>

          {/* Category filters */}
          {allTags.length > 0 && (
            <div className="flex gap-px px-[var(--spacing-x)] pb-1.5 overflow-x-auto shrink-0 scrollbar-none">
              <FilterPill label="All" active={!activeTag && filterMode === 'active'} onClick={() => { setActiveTag(null); setFilterMode('active') }} />
              {allTags.map((tag) => <FilterPill key={tag} label={tag} active={activeTag === tag && filterMode === 'active'} onClick={() => { setActiveTag(activeTag === tag ? null : tag); setFilterMode('active') }} />)}
              {flaggedCount > 0 && <FilterPill label="Flagged" active={filterMode === 'flagged'} variant="warning" onClick={() => { setFilterMode(filterMode === 'flagged' ? 'active' : 'flagged'); setActiveTag(null) }} />}
              {retiredCount > 0 && <FilterPill label="Retired" active={filterMode === 'retired'} variant="dim" onClick={() => { setFilterMode(filterMode === 'retired' ? 'active' : 'retired'); setActiveTag(null) }} />}
            </div>
          )}
        </>
      )}

      <div className="h-px bg-border shrink-0" />

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-[var(--spacing-x)] py-8 text-center text-[12px] text-text-tertiary">
            {catalog.length > 0 ? 'No matching cards.' : 'No cards yet.'}
          </div>
        ) : filtered.map((item, i) => (
          <Row key={item.id} item={item} last={i === filtered.length - 1}
            selectMode={selectMode} isSelected={selected.has(item.id)}
            onToggle={() => toggleSelect(item.id)}
            onLongSelect={() => toggleSelect(item.id)} />
        ))}
      </div>

      {/* Bulk delete confirmation */}
      <Dialog open={confirmAction === 'delete'} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <DialogContent>
          <DialogTitle>Delete {selected.size} cards?</DialogTitle>
          <DialogDescription>This will permanently remove the selected cards from your study deck.</DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <DialogClose asChild>
              <button className="h-7 px-3 border border-border rounded-[var(--radius-md)] bg-transparent text-text-secondary text-[12px] font-medium cursor-pointer hover:bg-surface transition-colors">
                Cancel
              </button>
            </DialogClose>
            <button onClick={handleBulkDelete}
              className="h-7 px-3 border-none rounded-[var(--radius-md)] bg-danger text-white text-[12px] font-medium cursor-pointer hover:brightness-110 transition-all">
              Delete {selected.size} cards
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Retag dialog */}
      <Dialog open={confirmAction === 'retag'} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <DialogContent>
          <DialogTitle>Recategorize {selected.size} cards</DialogTitle>
          <DialogDescription>Set the tags for all selected cards. Separate multiple tags with spaces.</DialogDescription>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              {allTags.map(tag => (
                <button key={tag} onClick={() => setRetagValue(tag)}
                  className={`h-[22px] px-2 rounded-[var(--radius-sm)] border-none cursor-pointer text-[11px] font-medium transition-colors ${
                    retagValue === tag ? 'bg-accent-subtle text-accent' : 'bg-surface text-text-tertiary hover:text-text-secondary'
                  }`}>{tag}</button>
              ))}
            </div>
            <input value={retagValue} onChange={(e) => setRetagValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBulkRetag() }}
              placeholder="tag1 tag2 ..."
              autoFocus
              className="w-full h-7 px-2.5 bg-surface border border-border rounded-[var(--radius-md)] text-text-primary text-[12px] outline-none focus:border-accent/40 transition-colors" />
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <DialogClose asChild>
              <button className="h-7 px-3 border border-border rounded-[var(--radius-md)] bg-transparent text-text-secondary text-[12px] font-medium cursor-pointer hover:bg-surface transition-colors">
                Cancel
              </button>
            </DialogClose>
            <button onClick={handleBulkRetag} disabled={!retagValue.trim()}
              className="h-7 px-3 border-none rounded-[var(--radius-md)] bg-accent text-white text-[12px] font-medium cursor-pointer hover:brightness-110 disabled:opacity-30 transition-all">
              Apply
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merging overlay */}
      {merging && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(30,30,34,0.97)] border border-border rounded-[var(--radius-lg)] text-[12px] text-text-secondary">
            <Spinner /> Merging {selected.size} cards...
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 px-3 py-2 bg-[rgba(30,30,34,0.95)] backdrop-blur-xl border border-border rounded-[var(--radius-md)] animate-fade-up z-40">
          <span className="text-[12px] text-text-secondary flex-1">{toast.message}</span>
          {toast.cardId && (
            <button onClick={() => {
              const id = toast.cardId!
              setToast(null)
              setSelected(new Set())
              setFilterMode('active')
              setActiveTag(null)
              onSearch(id.slice(0, 8))
            }}
              className="text-[12px] font-mono font-semibold text-accent cursor-pointer bg-transparent border-none hover:text-accent/80 transition-colors">
              {toast.cardId.slice(0, 8)}
            </button>
          )}
          <button onClick={() => setToast(null)}
            className="text-text-tertiary bg-transparent border-none cursor-pointer hover:text-text-secondary transition-colors">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

function FilterPill({ label, active, variant, onClick }: { label: string; active: boolean; variant?: 'warning' | 'dim'; onClick: () => void }) {
  const activeStyle = variant === 'warning' ? 'bg-warning/15 text-warning'
    : variant === 'dim' ? 'bg-white/[0.06] text-text-secondary'
    : 'bg-accent-subtle text-accent'
  return (
    <button onClick={onClick}
      className={`shrink-0 h-[22px] px-2 rounded-[var(--radius-sm)] border-none cursor-pointer text-[11px] font-medium transition-colors ${
        active ? activeStyle : 'bg-transparent text-text-tertiary hover:text-text-secondary'
      }`}>{label}</button>
  )
}

function Row({ item, last, selectMode, isSelected, onToggle, onLongSelect }: {
  item: CatalogItem; last: boolean
  selectMode: boolean; isSelected: boolean
  onToggle: () => void; onLongSelect: () => void
}) {
  const c = item.accuracy === null ? 'bg-text-tertiary'
    : item.accuracy >= 80 ? 'bg-success' : item.accuracy >= 50 ? 'bg-warning' : 'bg-danger'

  const statusLabel = item.retired ? 'Retired' : item.flagged ? 'Flagged' : null
  const statusColor = item.retired ? 'text-text-tertiary' : 'text-warning'

  const handleRestore = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (item.flagged) await window.api.unflagCard(item.id)
    else if (item.retired) await window.api.unretireCard(item.id)
  }

  const handleClick = () => {
    if (selectMode) { onToggle(); return }
    window.api.openCardFromCatalog(item.id)
  }

  // Long press to enter select mode
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlePointerDown = () => {
    pressTimer.current = setTimeout(() => { onLongSelect() }, 400)
  }
  const handlePointerUp = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle()
  }

  return (
    <div onClick={handleClick}
      onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
      className={`group flex items-start gap-3 px-[var(--spacing-x)] py-2 cursor-pointer no-drag transition-colors hover:bg-surface ${!last ? 'border-b border-white/[0.03]' : ''} ${(item.retired || item.flagged) ? 'opacity-60' : ''} ${isSelected ? 'bg-accent/[0.06]' : ''}`}>
      <div className="relative w-4 h-4 mt-[3px] shrink-0 flex items-center justify-center">
        {/* Type dot — hidden when checkbox visible */}
        <span className={`w-1.5 h-1.5 rounded-full ${item.type === 'concept' ? 'bg-warning/60' : 'bg-accent/50'} ${selectMode ? 'hidden' : 'group-hover:hidden'}`} />
        {/* Checkbox — always shown in select mode, shown on hover otherwise */}
        <div onClick={handleCheckboxClick}
          className={`absolute inset-0 rounded-[3px] border flex items-center justify-center transition-colors ${
            selectMode ? '' : 'hidden group-hover:flex'
          } ${isSelected ? 'bg-accent border-accent text-white' : 'border-border bg-transparent hover:border-text-tertiary'}`}>
          {isSelected && <Check size={10} strokeWidth={3} />}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium leading-snug text-text-primary line-clamp-2">
          {stripMarkdownPreview(item.front)}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-text-tertiary">
          <span className="font-mono text-text-tertiary/50">{item.id.slice(0, 6)}</span>
          <span className="text-white/10">·</span>
          {item.tags?.length > 0 && <span className="truncate max-w-[120px]">{item.tags.join(', ')}</span>}
          {item.tags?.length > 0 && <span className="text-white/10">·</span>}
          <span>{item.got}✓ {item.miss}✗</span>
          <div className={`w-6 h-[2px] rounded-full ${c} opacity-50`} style={{ width: `${Math.max(6, (item.accuracy ?? 0) * 0.24)}px` }} />
        </div>
      </div>
      {!selectMode && (
        statusLabel ? (
          <button onClick={handleRestore}
            className={`shrink-0 text-[10px] ${statusColor} mt-[3px] bg-transparent border-none cursor-pointer hover:text-accent transition-colors`}
            title="Restore to active">
            {statusLabel} ↩
          </button>
        ) : (
          <span className="shrink-0 text-[10px] text-text-tertiary mt-[3px]">{item.dueLabel}</span>
        )
      )}
    </div>
  )
}
