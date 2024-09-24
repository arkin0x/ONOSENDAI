import React, { useRef, useState, useMemo, useEffect } from 'react'
import { useThree, ThreeEvent } from '@react-three/fiber'
import { Face, CyberspaceShard as ShardType, useBuilderStore, Vertex } from '../../store/BuilderStore'
import COLORS from '../../data/Colors'
import { ArrowHelper, Vector3, BufferGeometry, BufferAttribute } from 'three'
import { OrbitControls, Text } from '@react-three/drei'
import VertexSelectionIndicator from './VertexSelectionIndicator'
import Shard from '../Cyberspace/Shard'
import { Shard3DData, shardStateDataTo3DData } from './Shards'
import { b, g } from 'vitest/dist/suite-ynYMzeLu.js'

interface ShardEditorProps {
  shard: ShardType
  selectedTool: 'vertex' | 'face' | 'color' | 'move'
}

const ShardEditor: React.FC<ShardEditorProps> = ({ shard, selectedTool }) => {
  const { addVertex, updateVertex, removeVertex, addFace, removeFace } = useBuilderStore()
  const [hoveredVertex, setHoveredVertex] = useState<string | null>(null)
  const [selectedVertices, setSelectedVertices] = useState<string[]>([])
  const [draggedVertex, setDraggedVertex] = useState<string | null>(null)
  const [planeDown, setPlaneDown] = useState(false)
  const [dragCancelCreateVertex, setDragCancelCreateVertex] = useState(false)
  const [dragAxis, setDragAxis] = useState<'x' | 'y' | 'z' | null>(null)
  const [faceCreated, setFaceCreated] = useState(false)
  const [colorPickerVertex, setColorPickerVertex] = useState<string | null>(null)
  const [currentColor, setCurrentColor] = useState<{ r: number, g: number, b: number }>({ r: 255, g: 255, b: 255 })
  const [currentVertexId, setCurrentVertexId] = useState<string | null>(null)
  const [draggingColor, setDraggingColor] = useState<'r' | 'g' | 'b' | null>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const planeRef = useRef<THREE.Mesh>(null)

  useEffect(() => {
    setColorPickerVertex(null)
  }, [selectedTool])

  useEffect(() => {
    // console.log(currentColor)
  }, [currentColor])

  const shard3DData = useMemo(() => {
    if (!shard) return null
    return {
      vertices: shard.vertices.flatMap((v: Vertex) => v.position),
      colors: shard.vertices.flatMap((v: Vertex) => v.color),
      indices: shard.faces.flatMap((f: Face) => f.vertices as number[]),
      position: { x: 0, y: 0, z: 0 },
      display: "solid" as const,
    } as Shard3DData
  }, [shard])

  if (!shard3DData) return (
    <Text color={COLORS.RED} fontSize={0.5} position={[0, 0, 0]}>
      No shard data
    </Text>
  ) 

    const handlePlaneClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectedTool === 'vertex' && !dragCancelCreateVertex && event.button === 0 && event.object === planeRef.current && event.intersections.length < 3) {
      console.log(event.intersections)
      const { point } = event.intersections.sort((a, b) => b.distance - a.distance)[0]
  
      // Snap the point to the nearest 0.1
      const snappedPoint = {
        x: Math.round(point.x * 10) / 10,
        y: Math.round(point.y * 10) / 10,
        z: Math.round(point.z * 10) / 10,
      }
  
      addVertex([snappedPoint.x, snappedPoint.y, snappedPoint.z], [0, 0, 0])
    } else if (selectedTool === 'face' && selectedVertices.length === 3) {
      setSelectedVertices([])
      setFaceCreated(false)
    }
    setDragCancelCreateVertex(false)
    setPlaneDown(false)
  }

  const handleVertexRightClick = (event: ThreeEvent<MouseEvent>, id: string) => {
    event.stopPropagation()
    if (selectedTool !== 'vertex') return
    removeVertex(id)
  }

  const handleVertexDragStart = (event: ThreeEvent<MouseEvent>, id: string, axis: 'x' | 'y' | 'z') => {
    if (selectedTool !== 'move') return
    event.stopPropagation()
    console.log('drag start', id, axis)
    setDraggedVertex(id)
    setDragAxis(axis)
    document.addEventListener('pointermove', handleVertexDrag)
    document.addEventListener('pointerup', handleVertexDragEnd)
  }

  const handleVertexDrag = (event) => {
    if (draggedVertex && dragAxis) {
      const vertex = shard.vertices.find(v => v.id === draggedVertex)
      if (vertex) {
        const newPosition = [...vertex.position]
        const movementScale = 0.1
        
        switch (dragAxis) {
          case 'x':
            newPosition[0] += Math.sign(event.movementX) * movementScale
            break
          case 'y':
            newPosition[1] -= Math.sign(event.movementY) * movementScale
            break
          case 'z':
            newPosition[2] += Math.sign(event.movementX) * movementScale
            break
        }
        
        updateVertex(draggedVertex, newPosition as [number, number, number], vertex.color)
      }
    }
  }

  const handleVertexDragEnd = () => {
    setDraggedVertex(null)
    setDragAxis(null)
    document.removeEventListener('pointermove', handleVertexDrag)
    document.removeEventListener('pointerup', handleVertexDragEnd)
  }

  const handleVertexClick = (event: ThreeEvent<MouseEvent>, vertex: Vertex) => {
    event.stopPropagation()
    if (selectedTool === 'face') {
      setSelectedVertices(prev => {
        if (prev.includes(vertex.id)) {
          return prev.filter(v => v !== vertex.id)
        } else {
          const newSelected = [...prev, vertex.id]
          if (newSelected.length === 3) {
            addFace(newSelected)
            setFaceCreated(true)
            return newSelected // Keep the selection
          }
          return newSelected
        }
      })
    } else if (selectedTool === 'vertex') {
      // no op
    } else if (selectedTool === 'color') {
      // Open color picker
      setColorPickerVertex(vertex.id)
      setCurrentVertexId(vertex.id)
      const color = {
        r: vertex.color[0],
        g: vertex.color[1],
        b: vertex.color[2],
      }
      setCurrentColor(color)
 
    }
  }

  const handleVertexHover = (id: string | null) => {
    if (selectedTool !== 'move') return
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }

    if (id) {
      setHoveredVertex(id)
    } else {
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredVertex(null)
      }, 2000) // ms delay before hiding XYZ controls
    }
  }

  const handlePlaneDown = (event: ThreeEvent<MouseEvent>) => {
    if (event.button === 0) {
      setPlaneDown(true)
    }
  }

  const handlePlaneDrag = () => {
    if (planeDown && !dragCancelCreateVertex) {
      setDragCancelCreateVertex(true)
    }
  }

  const handleColorBoxMouseDown = (event: ThreeEvent<MouseEvent>, color: 'r' | 'g' | 'b') => {
    event.stopPropagation()
    setDraggingColor(color)
  }

  const handleColorBoxMouseMove = (event: ThreeEvent<MouseEvent>, vertex: Vertex) => {
    if (!draggingColor || !currentVertexId) return

    const boxPosition = new Vector3()
    event.object.getWorldPosition(boxPosition)
    const colorValue = (event.point.y - boxPosition.y + 0.5)
    const normColorValue = Math.min(1, Math.max(0, colorValue))
    const newColor = { ...currentColor }
    newColor[draggingColor] = normColorValue
    setCurrentColor(newColor)
    updateVertex(currentVertexId, vertex.position, [newColor.r, newColor.g, newColor.b])
  }

  const handleColorBoxMouseUp = () => {
    setDraggingColor(null)
  }

  return (
    <group onPointerMove={handleVertexDrag} onPointerUp={handleVertexDragEnd}>
      <OrbitControls enabled={!(draggedVertex || draggingColor)} />
      <mesh ref={planeRef} onPointerDown={handlePlaneDown} onPointerMove={handlePlaneDrag} onPointerUp={handlePlaneClick} rotation={[-Math.PI/2, 0, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {shard.vertices.map((vertex) => (
        <group key={vertex.id}>
          <mesh // actual vertex mesh
            position={vertex.position}
            onPointerOver={() => handleVertexHover(vertex.id)}
            onPointerOut={() => handleVertexHover(null)}
            onClick={(e) => handleVertexClick(e, vertex)}
            onContextMenu={(e) => handleVertexRightClick(e, vertex.id)}
          >
            <sphereGeometry args={[0.1, 32, 32]} />
            <meshPhongMaterial color={selectedVertices.includes(vertex.id) ? COLORS.ORANGE : COLORS.PURPLE} />
          </mesh>
          <mesh // invisible mesh to capture hover events
            position={vertex.position}
            onPointerOver={() => handleVertexHover(vertex.id)}
            onPointerOut={() => handleVertexHover(null)}
          >
            <sphereGeometry args={[0.3, 32, 32]} />
            <meshBasicMaterial visible={false} />
          </mesh>
          {hoveredVertex === vertex.id && (
            <>
              <arrowHelper args={[new Vector3(1, 0, 0), new Vector3(...vertex.position), 0.5, COLORS.RED]} />
              <arrowHelper args={[new Vector3(0, 1, 0), new Vector3(...vertex.position), 0.5, COLORS.GREEN]} />
              <arrowHelper args={[new Vector3(0, 0, 1), new Vector3(...vertex.position), 0.5, COLORS.BLUE]} />
              <mesh position={[vertex.position[0] + 0.25, vertex.position[1], vertex.position[2]]} onPointerDown={(e) => handleVertexDragStart(e, vertex.id, 'x')}>
                <boxGeometry args={[0.1, 0.1, 0.1]} />

                <meshBasicMaterial color={COLORS.RED} />
              </mesh>
              <mesh position={[vertex.position[0], vertex.position[1] + 0.25, vertex.position[2]]} onPointerDown={(e) => handleVertexDragStart(e, vertex.id, 'y')}>
                <boxGeometry args={[0.1, 0.1, 0.1]} />
                <meshBasicMaterial color={COLORS.GREEN} />
              </mesh>
              <mesh position={[vertex.position[0], vertex.position[1], vertex.position[2] + 0.25]} onPointerDown={(e) => handleVertexDragStart(e, vertex.id, 'z')}>
                <boxGeometry args={[0.1, 0.1, 0.1]} />
                <meshBasicMaterial color={COLORS.BLUE} />
              </mesh>
            </>
          )}
          {selectedTool === 'color' && colorPickerVertex === vertex.id && (
            <group position={vertex.position}>
              <mesh key={0} position={[-.2, 0, .2]} onPointerDown={(e) => handleColorBoxMouseDown(e, 'r')} onPointerMove={(e) => handleColorBoxMouseMove(e, vertex)} onPointerUp={handleColorBoxMouseUp} onPointerLeave={handleColorBoxMouseUp}>
                <boxGeometry args={[0.1, 2, 0.1]} />
                <meshBasicMaterial color={`rgb(${Math.round(currentColor.r * 255)}, 0, 0)`} />
              </mesh>
              <mesh key={1} position={[0, 0, .2]} onPointerDown={(e) => handleColorBoxMouseDown(e, 'g')} onPointerMove={(e) => handleColorBoxMouseMove(e, vertex)} onPointerUp={handleColorBoxMouseUp} onPointerLeave={handleColorBoxMouseUp}>
                <boxGeometry args={[0.1, 2, 0.1]} />
                <meshBasicMaterial color={`rgb(0, ${Math.round(currentColor.g * 255)}, 0)`} />
              </mesh>
              <mesh key={2} position={[.2, 0, .2]} onPointerDown={(e) => handleColorBoxMouseDown(e, 'b')} onPointerMove={(e) => handleColorBoxMouseMove(e, vertex)} onPointerUp={handleColorBoxMouseUp} onPointerLeave={handleColorBoxMouseUp}>
                <boxGeometry args={[0.1, 2, 0.1]} />
                <meshBasicMaterial color={`rgb(0, 0, ${Math.round(currentColor.b * 255)})`} />
              </mesh>
            </group>
          )}
        </group>
      ))}
      <Shard shardData={shard3DData} />
      { selectedTool === 'face' ? <VertexSelectionIndicator selectedVertices={selectedVertices} faceCreated={faceCreated} /> : null }
    </group>
  )
}

export default ShardEditor