import { useState, useEffect } from 'react'
import type { KnowledgeLog } from '../lib/types'
import { MarkdownRender } from '../components/markdown-render'
import { Spinner } from '../components/spinner'
import { Search, ArrowLeft } from 'lucide-react'

type Sub = 'list' | 'detail' | 'results'

export function KnowledgeView() {
  const [sub, setSub] = useState<Sub>('list')
  const [logs, setLogs] = useState<KnowledgeLog[]>([])
  const [chromaOnline, setChromaOnline] = useState<boolean | null>(null)
  const [detail, setDetail] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState('')
  const [searching, setSearching] = useState(false)

  useEffect(() => { window.api.getKnowledgeLogs().then(setLogs); window.api.getChromaStatus().then(setChromaOnline) }, [])

  const openLog = async (f: string) => { const c = await window.api.getKnowledgeLog(f); if (c) { setDetail(c); setSub('detail') } }
  const doSearch = async () => { const q = query.trim(); if (!q) return; setSub('results'); setSearching(true); setResults(await window.api.searchKnowledge(q)); setSearching(false) }
  const tags = (s: string) => s.replace(/[\[\]"]/g, '').split(',').map((t) => t.trim()).filter(Boolean).join(', ')

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden no-drag">
      <div className="flex items-center gap-2 px-[var(--spacing-x)] h-8 shrink-0 border-b border-border">
        <span className="text-[13px] font-semibold">Knowledge</span>
        <span className="text-[10px] text-text-tertiary">{logs.length} logs</span>
        <span className={`text-[10px] ml-auto ${chromaOnline ? 'text-success/70' : chromaOnline === false ? 'text-danger/70' : 'text-text-tertiary'}`}>
          {chromaOnline ? 'DB connected' : chromaOnline === false ? 'DB offline' : '...'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 px-[var(--spacing-x)] py-1.5 border-b border-border shrink-0">
        <Search size={12} className="text-text-tertiary shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="Semantic search..."
          className="flex-1 bg-surface border border-transparent rounded-[var(--radius-md)] text-text-primary text-[12px] px-2.5 py-1 outline-none focus:border-accent/30 transition-colors" />
        <button onClick={doSearch} className="w-6 h-6 border-none rounded-[var(--radius-md)] bg-accent text-white text-xs cursor-pointer flex items-center justify-center shrink-0">↑</button>
      </div>

      {sub === 'list' && (
        <div className="flex-1 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="px-[var(--spacing-x)] py-6 text-[12px] text-text-tertiary text-center">No logs yet.</div>
          ) : logs.map((log) => (
            <div key={log.filename} onClick={() => openLog(log.filename)}
              className="px-[var(--spacing-x)] py-2 cursor-pointer border-b border-white/[0.03] hover:bg-surface transition-colors">
              <div className="text-[12px] font-medium text-text-primary overflow-hidden whitespace-nowrap text-ellipsis">{log.problem}</div>
              <div className="flex gap-2 mt-px text-[10px] text-text-tertiary">
                <span>{log.date || '—'}</span>
                {log.tags && <span className="text-accent/50">{tags(log.tags)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {sub === 'detail' && (
        <div className="flex-1 overflow-y-auto px-[var(--spacing-x)] py-3 flex flex-col gap-2">
          <button onClick={() => setSub('list')} className="bg-transparent border-none text-text-tertiary text-[11px] cursor-pointer text-left p-0 flex items-center gap-1 hover:text-text-secondary">
            <ArrowLeft size={11} /> Back
          </button>
          <div className="text-[12px] leading-[1.7]"><MarkdownRender content={detail} /></div>
        </div>
      )}

      {sub === 'results' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-[var(--spacing-x)] py-1.5 border-b border-border shrink-0">
            <button onClick={() => { setSub('list'); setQuery('') }} className="bg-transparent border-none text-text-tertiary text-[11px] cursor-pointer p-0 flex items-center gap-1 hover:text-text-secondary">
              <ArrowLeft size={11} /> Back
            </button>
            <span className="text-[11px] text-text-tertiary truncate">"{query}"</span>
          </div>
          <div className="flex-1 overflow-y-auto px-[var(--spacing-x)] py-3 text-[12px] leading-[1.7] whitespace-pre-wrap text-text-secondary">
            {searching ? <div className="flex items-center gap-2 text-text-tertiary py-4"><Spinner /> Searching...</div> : results}
          </div>
        </div>
      )}
    </div>
  )
}
