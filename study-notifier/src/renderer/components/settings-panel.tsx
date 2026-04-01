import { useState, useEffect } from 'react'
import type { Settings } from '../lib/types'

interface Props { open: boolean; onClose: () => void }
const ANNOY_LABELS = ['Off', 'Low', 'Med', 'High']

export function SettingsPanel({ open, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [teamToken, setTeamToken] = useState('')
  const [autoTagging, setAutoTagging] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [configResult, setConfigResult] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      window.api.getSettings().then((s) => {
        setSettings(s)
        setServerUrl(s.serverUrl || '')
        setTeamToken(s.teamToken || '')
      })
      setConfigResult(null)
    }
  }, [open])

  if (!open || !settings) return null

  const save = () => {
    window.api.saveSettings({
      ...settings,
      serverUrl: serverUrl || undefined,
      teamToken: teamToken || undefined,
    })
    onClose()
  }

  const runAutoTag = async () => {
    setAutoTagging(true)
    try { const r = await window.api.autoTagCards(); if (!r.ok) alert(r.error || 'Auto-tag failed'); else window.api.openCatalog() }
    finally { setAutoTagging(false) }
  }

  const configureMcp = async () => {
    setConfiguring(true)
    setConfigResult(null)
    try {
      const r = await window.api.configureMcp()
      setConfigResult(r.ok ? 'Claude Code configured' : (r.error || 'Failed'))
    } finally {
      setConfiguring(false)
    }
  }

  const inputCls = "w-full bg-surface border border-border rounded-[var(--radius-md)] text-text-primary text-[12px] px-2.5 py-1.5 outline-none focus:border-accent/40 transition-colors"
  const btnCls = "w-full h-7 border border-border rounded-[var(--radius-md)] bg-transparent text-text-secondary text-[12px] font-medium cursor-pointer hover:bg-surface hover:text-text-primary disabled:opacity-40 transition-colors"

  return (
    <div className="flex flex-col gap-[var(--spacing-gap)] px-[var(--spacing-x)] py-[var(--spacing-y)] shrink-0 border-t border-border no-drag">
      <Row label="Notify every" value={`${settings.intervalMinutes}m`}>
        <input type="range" min={5} max={120} step={5} value={settings.intervalMinutes} onChange={(e) => setSettings({ ...settings, intervalMinutes: +e.target.value })} className="flex-1 accent-accent cursor-pointer" />
      </Row>
      <Row label="Cards / session" value={String(settings.cardsPerSession)}>
        <input type="range" min={1} max={10} step={1} value={settings.cardsPerSession} onChange={(e) => setSettings({ ...settings, cardsPerSession: +e.target.value })} className="flex-1 accent-accent cursor-pointer" />
      </Row>
      <Row label="Retire after" value={`${settings.retireThreshold} correct`}>
        <input type="range" min={3} max={10} step={1} value={settings.retireThreshold} onChange={(e) => setSettings({ ...settings, retireThreshold: +e.target.value })} className="flex-1 accent-accent cursor-pointer" />
      </Row>
      <Row label="Annoyance" value={ANNOY_LABELS[settings.annoyanceLevel]}>
        <input type="range" min={0} max={3} step={1} value={settings.annoyanceLevel} onChange={(e) => setSettings({ ...settings, annoyanceLevel: +e.target.value })} className="flex-1 accent-accent cursor-pointer" />
      </Row>
      <Row label="Launch at login" value={settings.launchAtLogin ? 'On' : 'Off'}>
        <input type="range" min={0} max={1} step={1} value={settings.launchAtLogin ? 1 : 0} onChange={(e) => setSettings({ ...settings, launchAtLogin: +e.target.value === 1 })} className="flex-1 accent-accent cursor-pointer" />
      </Row>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-text-secondary">Server URL</span>
        <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://knowledge-scribe.up.railway.app" className={inputCls} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-text-secondary">Team token</span>
        <input type="password" value={teamToken} onChange={(e) => setTeamToken(e.target.value)} placeholder="token..."
          onFocus={(e) => (e.target.type = 'text')} onBlur={(e) => (e.target.type = 'password')} className={inputCls} />
      </div>

      <button onClick={configureMcp} disabled={configuring || !serverUrl} className={btnCls}>
        {configuring ? 'Configuring...' : 'Connect Claude Code'}
      </button>
      {configResult && <span className="text-[11px] text-text-secondary text-center">{configResult}</span>}

      <button onClick={runAutoTag} disabled={autoTagging} className={btnCls}>
        {autoTagging ? 'Running...' : 'Auto-generate categories'}
      </button>
      <button onClick={save}
        className="w-full h-7 border-none rounded-[var(--radius-md)] bg-accent text-white text-[12px] font-medium cursor-pointer hover:brightness-110 transition-all">
        Save settings
      </button>
    </div>
  )
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-text-secondary shrink-0 w-[100px]">{label}</span>
      {children}
      <span className="text-[12px] font-medium min-w-[28px] text-right text-text-primary">{value}</span>
    </div>
  )
}
