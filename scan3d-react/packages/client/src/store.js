import { create } from 'zustand'

export const useStore = create((set) => ({
  scanning: false,
  mode: 'IDLE',
  arReady: false,

  jobId: null,
  jobStatus: null,
  jobMessage: '',
  meshUrl: null,      // .ply da nuvem de pontos (COLMAP)

  avatarUrl: null,    // .glb do avatar (genesis-api)

  points: [],
  scanId: null,

  setScanning: (v) => set({ scanning: v }),
  setMode: (mode) => set({ mode }),
  setArReady: (v) => set({ arReady: v }),
  setJob: (patch) => set(patch),
  resetJob: () => set({ jobId: null, jobStatus: null, jobMessage: '', meshUrl: null }),
  setAvatarUrl: (url) => set({ avatarUrl: url }),
  setPoints: (points) => set({ points }),
  setScanId: (scanId) => set({ scanId }),
}))
