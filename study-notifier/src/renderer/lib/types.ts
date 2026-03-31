export type ViewType = 'hidden' | 'pill' | 'card' | 'catalog' | 'chat' | 'knowledge' | 'analytics'

export interface Card {
  id: string
  type: 'qa' | 'concept'
  front: string
  back: string
  tags: string[]
  when?: string
  how?: string
  example?: string
}

export interface Stats {
  total: number
  seen: number
  due: number
  streak: number
  totalGot: number
  totalMiss: number
}

export interface CatalogItem {
  id: string
  type: 'qa' | 'concept'
  front: string
  got: number
  miss: number
  accuracy: number | null
  dueLabel: string
  streak: number
  tags: string[]
}

export interface Settings {
  intervalMinutes: number
  annoyanceLevel: number
  cardsPerSession: number
  launchAtLogin: boolean
  categoryClusterK: number
  anthropicApiKey?: string
  openaiApiKey?: string
}

export interface AnalyticsData {
  totalReviews: number
  overallAccuracy: number
  streak: number
  daysActive: number
  categoryStats: CategoryStat[]
  activityByDay: ActivityDay[]
}

export interface CategoryStat {
  tag: string
  got: number
  miss: number
  total: number
  accuracy: number
}

export interface ActivityDay {
  date: string
  count: number
}

export interface KnowledgeLog {
  filename: string
  date: string
  problem: string
  tags: string
}

export interface ViewState {
  type: ViewType
  card?: Card
  stats?: Stats
  catalog?: CatalogItem[]
  sessionDone?: number
  sessionTotal?: number
  analytics?: AnalyticsData
}

export interface ElectronAPI {
  expand: () => void
  dismiss: () => void
  snooze: (mins: number) => void
  openCatalog: () => void
  openCardFromCatalog: (cardId: string) => void
  openChat: (card: Card) => void
  backToCard: () => void
  openKnowledge: () => void
  openAnalytics: () => void

  answer: (cardId: string, correct: boolean) => void
  saveSettings: (s: Partial<Settings>) => void
  getSettings: () => Promise<Settings>
  getStats: () => Promise<Stats>
  getCatalog: () => Promise<CatalogItem[]>

  editCardChat: (messages: { role: string; content: string }[], card: Card) => Promise<string>
  applyCardEdit: (cardId: string, front: string, back: string) => Promise<{ ok: boolean }>
  chatSend: (messages: { role: string; content: string }[], card: Card) => Promise<string>
  autoTagCards: () => Promise<{ ok: boolean; error?: string }>
  deleteCard: (cardId: string) => Promise<{ ok: boolean }>
  indexCards: () => Promise<{ ok: boolean; count?: number; error?: string }>
  semanticSearchCards: (query: string) => Promise<{ ok: boolean; orderedIds?: string[]; error?: string }>
  setCardTags: (cardId: string, tags: string[]) => Promise<{ ok: boolean }>
  evaluateAnswer: (cardId: string, answer: string) => Promise<{ ok: boolean; score?: number; feedback?: string; error?: string }>

  getView: () => Promise<ViewState>
  onView: (cb: (v: ViewState) => void) => void
  offView: (cb: (v: ViewState) => void) => void
  onAnnoy: (cb: () => void) => void
  offAnnoy: (cb: () => void) => void

  getKnowledgeLogs: () => Promise<KnowledgeLog[]>
  getKnowledgeLog: (filename: string) => Promise<string | null>
  searchKnowledge: (query: string) => Promise<string>
  getChromaStatus: () => Promise<boolean>

  getAnalytics: () => Promise<AnalyticsData>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
