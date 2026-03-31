// Re-export types and provide typed access to window.api
// The actual API is exposed by preload.js via contextBridge
import type { ElectronAPI } from './types'

export function getApi(): ElectronAPI {
  return window.api
}
