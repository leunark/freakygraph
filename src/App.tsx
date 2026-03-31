import { useEffect, useRef } from 'react'
import { initPixiRenderer, type PixiRendererHandle } from './renderer/pixiRenderer'

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    let disposed = false
    let handle: PixiRendererHandle | null = null

    void initPixiRenderer(canvas).then((nextHandle) => {
      if (disposed) {
        nextHandle.destroy()
        return
      }

      handle = nextHandle
    })

    return () => {
      disposed = true
      handle?.destroy()
    }
  }, [])

  return <canvas ref={canvasRef} />
}

export default App
