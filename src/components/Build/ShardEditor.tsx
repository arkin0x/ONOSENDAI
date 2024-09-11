import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Shard as ShardType, useBuilderStore } from '../../store/BuilderStore';
import COLORS from '../../data/Colors';
import { ArrowHelper, Vector3, BufferGeometry, BufferAttribute } from 'three';
import { OrbitControls, Text } from '@react-three/drei';
import VertexSelectionIndicator from './VertexSelectionIndicator';
import Shard from '../Cyberspace/Shard'

interface ShardEditorProps {
  shard: ShardType;
  selectedTool: 'vertex' | 'face';
}

const ShardEditor: React.FC<ShardEditorProps> = ({ shard, selectedTool }) => {
  const { addVertex, updateVertex, removeVertex, addFace, removeFace } = useBuilderStore();
  const { scene, camera } = useThree();
  const [hoveredVertex, setHoveredVertex] = useState<string | null>(null);
  const [selectedVertices, setSelectedVertices] = useState<string[]>([]);
  const [draggedVertex, setDraggedVertex] = useState<string | null>(null);
  const [planeDown, setPlaneDown] = useState(false);
  const [dragCancelCreateVertex, setDragCancelCreateVertex] = useState(false);
  const [dragAxis, setDragAxis] = useState<'x' | 'y' | 'z' | null>(null);
  const [faceCreated, setFaceCreated] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const planeRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    console.log('planeDown', planeDown, 'dragCancel', dragCancelCreateVertex)
  },[dragCancelCreateVertex])

  const handlePlaneClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectedTool === 'vertex' && !dragCancelCreateVertex && event.button === 0 && event.object === planeRef.current && event.intersections.length < 3) {
      console.log(event.intersections)
      const { point } = event.intersections.sort((a,b) => b.distance-a.distance)[0]
      addVertex([point.x, point.y, point.z], [1, 1, 1]);
    } else if (selectedTool === 'face' && selectedVertices.length === 3) {
      setSelectedVertices([]);
      setFaceCreated(false);
    }
    setDragCancelCreateVertex(false);
    setPlaneDown(false);
  };

  const handleVertexRightClick = (event: ThreeEvent<MouseEvent>, id: string) => {
    event.stopPropagation();
    removeVertex(id);
  };

  const handleVertexDragStart = (event: ThreeEvent<MouseEvent>, id: string, axis: 'x' | 'y' | 'z') => {
    event.stopPropagation();
    console.log('drag start', id, axis);
    setDraggedVertex(id);
    setDragAxis(axis);
    document.addEventListener('pointermove', handleVertexDrag);
    document.addEventListener('pointerup', handleVertexDragEnd);
  };

  const handleVertexDrag = (event) => {
    if (draggedVertex && dragAxis) {
      const vertex = shard.vertices.find(v => v.id === draggedVertex);
      if (vertex) {
        const newPosition = [...vertex.position];
        const movementScale = 0.01;
        
        switch (dragAxis) {
          case 'x':
            newPosition[0] += event.movementX * movementScale;
            break;
          case 'y':
            newPosition[1] -= event.movementY * movementScale;
            break;
          case 'z':
            newPosition[2] += event.movementX * movementScale;
            break;
        }
        
        updateVertex(draggedVertex, newPosition as [number, number, number], vertex.color);
      }
    }
  };

  const handleVertexDragEnd = () => {
    setDraggedVertex(null);
    setDragAxis(null);
    document.removeEventListener('pointermove', handleVertexDrag);
    document.removeEventListener('pointerup', handleVertexDragEnd);
  };

  const handleVertexClick = (event: ThreeEvent<MouseEvent>, id: string) => {
    event.stopPropagation();
    if (selectedTool === 'face') {
      setSelectedVertices(prev => {
        if (prev.includes(id)) {
          return prev.filter(v => v !== id);
        } else {
          const newSelected = [...prev, id];
          if (newSelected.length === 3) {
            addFace(newSelected);
            setFaceCreated(true);
            return newSelected; // Keep the selection
          }
          return newSelected;
        }
      });
    } else if (selectedTool === 'vertex') {
      // Open color picker (not implemented in this example)
      console.log('Open color picker for vertex', id);
    }
  };

  const handleVertexHover = (id: string | null) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    if (id) {
      setHoveredVertex(id);
    } else {
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredVertex(null);
      }, 750); // 300ms delay before hiding XYZ controls
    }
  };

  const handlePlaneDown = (event: ThreeEvent<MouseEvent>) => {
    if (event.button === 0) {
      setPlaneDown(true);
    }
  }

  const handlePlaneDrag = () => {
    if (planeDown && !dragCancelCreateVertex) {
      setDragCancelCreateVertex(true);
    }
  }

  const shardData = useMemo(() => {
    return {
      vertices: shard.vertices.flatMap(v => v.position),
      colors: shard.vertices.flatMap(v => v.color),
      indices: shard.faces.flatMap(f => f.vertices),
      position: { x: 0, y: 0, z: 0 },
      display: "solid" as const,
    };
  }, [shard.vertices, shard.faces]);

  return (
    <group onPointerMove={handleVertexDrag} onPointerUp={handleVertexDragEnd}>
      { draggedVertex ? null : <OrbitControls /> } 
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
            onClick={(e) => handleVertexClick(e, vertex.id)}
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
        </group>
      ))}
      <Shard shardData={shardData} />
      { selectedTool === 'face' ? <VertexSelectionIndicator selectedVertices={selectedVertices} faceCreated={faceCreated} /> : null }
    </group>
  );
};

export default ShardEditor;