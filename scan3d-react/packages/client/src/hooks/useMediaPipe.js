import { useRef, useEffect, useCallback, useState } from 'react'

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const ZERO = { x: 0, y: 0, z: 0, visibility: 0 }

const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export default function useMediaPipe() {
  const poseRef = useRef(null)
  const faceRef = useRef(null)
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let cancelado = false

    async function init() {
      try {
        const { PoseLandmarker, FaceLandmarker, FilesetResolver } =
          await import('@mediapipe/tasks-vision')

        const vision = await FilesetResolver.forVisionTasks(CDN)

        const [pose, face] = await Promise.all([
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO', numPoses: 1,
            minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
            outputSegmentationMasks: false,
          }),
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO', numFaces: 1,
            minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
            outputFaceBlendshapes: false,
          }),
        ])

        if (!cancelado) {
          poseRef.current = pose
          faceRef.current = face
          setPronto(true)
        }
      } catch (e) {
        if (!cancelado) setErro(e.message)
      }
    }

    init()

    return () => {
      cancelado = true
      poseRef.current?.close()
      faceRef.current?.close()
    }
  }, [])

  const detectar = useCallback((videoEl, timestamp) => {
    if (!poseRef.current || !videoEl) return null
    try {
      const poseResult = poseRef.current.detectForVideo(videoEl, timestamp)
      const faceResult = faceRef.current?.detectForVideo(videoEl, timestamp)

      const pose = poseResult.landmarks?.[0] || []
      const face = faceResult?.faceLandmarks?.[0] || []

      const combinados = [
        ...Array.from({ length: 33 }, (_, i) =>
          pose[i] ? { x: pose[i].x, y: pose[i].y, z: pose[i].z, visibility: pose[i].visibility ?? 1 } : ZERO),
        ...Array.from({ length: 468 }, (_, i) =>
          face[i] ? { x: face[i].x, y: face[i].y, z: face[i].z, visibility: 1 } : ZERO),
        ...Array.from({ length: 21 }, () => ZERO),
        ...Array.from({ length: 21 }, () => ZERO),
      ]

      return { landmarks: [combinados], poseLandmarks: poseResult.landmarks, faceLandmarks: faceResult?.faceLandmarks }
    } catch {
      return null
    }
  }, [])

  return { pronto, erro, detectar }
}
