const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ── Navigation / session ──
  expand:     ()               => ipcRenderer.send('expand'),
  dismiss:    ()               => ipcRenderer.send('dismiss'),
  snooze:     (mins)           => ipcRenderer.send('snooze', mins),
  openCatalog:()               => ipcRenderer.send('catalog'),
  openCardFromCatalog:(cardId) => ipcRenderer.send('open-card-from-catalog', cardId),
  openChat:   (card)           => ipcRenderer.send('chat', card),
  backToCard: ()               => ipcRenderer.send('back-to-card'),

  // ── Card answers ──
  answer:     (cardId, correct)=> ipcRenderer.send('answer', { cardId, correct }),

  // ── Settings ──
  saveSettings:(s)             => ipcRenderer.send('settings:save', s),
  getSettings: ()              => ipcRenderer.invoke('settings:get'),

  // ── Data ──
  getStats:    ()              => ipcRenderer.invoke('stats:get'),
  getCatalog:  ()              => ipcRenderer.invoke('catalog:get'),

  // ── AI ──
  editCardChat:(messages, card)=> ipcRenderer.invoke('edit-card-chat', { card, messages }),
  applyCardEdit:(cardId, front, back)=> ipcRenderer.invoke('apply-card-edit', { cardId, front, back }),
  chatSend:    (messages, card)=> ipcRenderer.invoke('chat-send', { messages, card }),
  autoTagCards: ()              => ipcRenderer.invoke('auto-tag-cards'),
  deleteCard:  (cardId)        => ipcRenderer.invoke('delete-card', { cardId }),

  // ── View state (pull + push) ──
  getView:     ()   => ipcRenderer.invoke('get-view'),
  onView:      (cb) => ipcRenderer.on('view', (_, d) => cb(d)),

  // ── Legacy events (still used for annoyance) ──
  onAnnoy:     (cb) => ipcRenderer.on('annoy', () => cb()),
})
