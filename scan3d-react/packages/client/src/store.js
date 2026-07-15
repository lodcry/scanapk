import { create } from 'zustand'

export const useStore = create((set, get) => ({
  scanId: null,
  scanning: false,
  points: [],
  arObjects: [],
  mode: 'IDLE',

  setScanId: (id) => set({ scanId: id }),
  setScanning: (v) => set({ scanning: v }),

  // ⚠️ CORREÇÃO CRÍTICA: limite máximo + descarte circular
  addPoints: (pts) => {
    const current = get().points
    const MAX = 8000 // seguro para mobile

    if (current.length >= MAX) {
      const cut = Math.floor(MAX * 0.2)
      set({ points: [...current.slice(cut), ...pts].slice(-MAX) })
    } else {
      const total = current.length + pts.length
      if (total > MAX) {
        const room = MAX - current.length
        set({ points: [...current, ...pts.slice(0, room)] })
      } else {
        set({ points: [...current, ...pts] })
      }
    }
  },

  setPoints: (pts) => set({ points: pts }),
  clearPoints: () => set({ points: [], arObjects: [], scanId: null, mode: 'IDLE' }),
  addArObject: (obj) => set(s => ({ arObjects: [...s.arObjects, obj] })),
  removeArObject: (id) => set(s => ({ arObjects: s.arObjects.filter(o => o.id !== id) })),
  setMode: (mode) => set({ mode }),
}))
