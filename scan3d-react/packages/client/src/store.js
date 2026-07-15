import { create } from 'zustand'

const MAX = 15000

export const useStore = create((set, get) => ({
  scanId: null,
  scanning: false,
  points: [],
  mode: 'IDLE',
  arReady: false,

  setScanId: (id) => set({ scanId: id }),
  setScanning: (v) => set({ scanning: v }),
  setMode: (mode) => set({ mode }),
  setArReady: (v) => set({ arReady: v }),

  addPoints: (pts) => {
    const current = get().points
    const merged = [...current, ...pts]
    set({ points: merged.length > MAX ? merged.slice(-MAX) : merged })
  },

  setPoints: (pts) => set({ points: pts.slice(-MAX) }),
  clearPoints: () => set({ points: [], scanId: null, mode: 'IDLE', scanning: false }),
}))
