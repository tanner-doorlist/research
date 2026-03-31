const { contextBridge, ipcRenderer } = require('electron')

const api = {
  expand:     ()               => ipcRenderer.send('expand'),
  dismiss:    ()               => ipcRenderer.send('dismiss'),
  snooze:     (mins)           => ipcRenderer.send('snooze', mins),
  openCatalog:()               => ipcRenderer.send('catalog'),
  openCardFromCatalog:(cardId) => ipcRenderer.send('open-card-from-catalog', cardId),
  openChat:   (card)           => ipcRenderer.send('chat', card),
  backToCard: ()               => ipcRenderer.send('back-to-card'),

  answer:     (cardId, correct)=> ipcRenderer.send('answer', { cardId, correct }),

  saveSettings:(s)             => ipcRenderer.send('settings:save', s),
  getSettings: ()              => ipcRenderer.invoke('settings:get'),

  getStats:    ()              => ipcRenderer.invoke('stats:get'),
  getCatalog:  ()              => ipcRenderer.invoke('catalog:get'),

  editCardChat:(messages, card)=> ipcRenderer.invoke('edit-card-chat', { card, messages }),
  applyCardEdit:(cardId, front, back)=> ipcRenderer.invoke('apply-card-edit', { cardId, front, back }),
  chatSend:    (messages, card)=> ipcRenderer.invoke('chat-send', { messages, card }),
  autoTagCards: ()              => ipcRenderer.invoke('auto-tag-cards'),
  deleteCard:  (cardId)        => ipcRenderer.invoke('delete-card', { cardId }),

  getView:     ()   => ipcRenderer.invoke('get-view'),
  onView:      (cb) => { const wrapped = (_, d) => cb(d); cb._wrapped = wrapped; ipcRenderer.on('view', wrapped) },
  offView:     (cb) => { ipcRenderer.removeListener('view', cb._wrapped || cb) },
  onAnnoy:     (cb) => { const wrapped = () => cb(); cb._wrapped = wrapped; ipcRenderer.on('annoy', wrapped) },
  offAnnoy:    (cb) => { ipcRenderer.removeListener('annoy', cb._wrapped || cb) },

  openKnowledge:    ()         => ipcRenderer.send('knowledge'),
  getKnowledgeLogs: ()         => ipcRenderer.invoke('knowledge:get-logs'),
  getKnowledgeLog:  (filename) => ipcRenderer.invoke('knowledge:get-log', { filename }),
  searchKnowledge:  (query)    => ipcRenderer.invoke('knowledge:search', { query }),
  getChromaStatus:  ()         => ipcRenderer.invoke('knowledge:chroma-status'),

  openAnalytics:        ()               => ipcRenderer.send('analytics'),
  getAnalytics:         ()               => ipcRenderer.invoke('analytics:get'),
  indexCards:           ()               => ipcRenderer.invoke('cards:index-embeddings'),
  semanticSearchCards:  (query)          => ipcRenderer.invoke('cards:semantic-search', { query }),
  setCardTags:          (cardId, tags)   => ipcRenderer.invoke('cards:set-tags', { cardId, tags }),
  evaluateAnswer:       (cardId, answer) => ipcRenderer.invoke('answer:evaluate', { cardId, answer }),
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (_) {
  /* bridge failed — renderer will show retry / error state */
}
