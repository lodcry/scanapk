import { create } from 'zustand'

export const useStore = create((set) => ({
  scanning: false,
  mode: 'IDLE',
  arReady: false,

  jobId: null,
  jobStatus: null,
  jobMessage: '',
  meshUrl: null,

  setScanning: (v) => set({ scanning: v }),
  setMode: (mode) => set({ mode }),
  setArReady: (v) => set({ arReady: v }),

  setJob: (patch) => set(patch),
  resetJob: () => set({ jobId: null, jobStatus: null, jobMessage: '', meshUrl: null }),
}))
