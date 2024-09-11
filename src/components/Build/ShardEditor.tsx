import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Shard, useBuilderStore } from '../../store/BuilderStore';
import COLORS from '../../data/Colors';
import { ArrowHelper, Vector3, BufferGeometry, BufferAttribute } from 'three';
import { Text } from '@react-three/drei';
import VertexSelectionIndicator from './VertexSelectionIndicator';

interface ShardEditorProps {
  shard: Shard;
  selectedTool: 'vertex' | 'face';
}

const ShardEditor: React.FC<ShardEditorProps> = ({ shard, selectedTool }) => {
  const { addVertex, updateVertex, removeVertex, addFace } = useBuilderStore();
  const { scene, camera } = useThree();
  const [hoveredVertex, setHoveredVertex] = useState<string | null>(null);
  const [selectedVertices, setSelectedVertices] = useState<string[]>([]);
  const [draggedVertex, setDraggedVertex] = useState<string | null>(null);
  const [dragAxis, setDragAxis] = useState<'x' | 'y' | 'z' | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePlaneClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectedTool === 'vertex' && !draggedVertex) {
      const { point } = event.intersections[0];
      addVertex([point.x, point.y, point.z], [1, 1, 1]);
    }
  };

  const handleVertexRightClick = (event: ThreeEvent<MouseEvent>, id: string) => {
    event.stopPropagation();
    removeVertex(id);
  };

  const handleVertexDragStart = (event: ThreeEvent<MouseEvent>, id: string, axis: 'x' | 'y' | 'z') => {
    event.stopPropagation();
    setDraggedVertex(id);
    setDragAxis(axis);
  };

  const handleVertexDrag = (event: ThreeEvent<MouseEvent>) => {
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
            return [];
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
      }, 300); // 300ms delay before hiding XYZ controls
    }
  };

  const selectedFaceGeometry = useMemo(() => {
    if (selectedVertices.length < 2) return null;

    const geometry = new BufferGeometry();
    const positions = selectedVertices.flatMap(id => {
      const vertex = shard.vertices.find(v => v.id === id);
      return vertex ? vertex.position : [0, 0, 0];
    });

    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));

    if (selectedVertices.length === 2) {
      geometry.setIndex([0, 1]);
    } else if (selectedVertices.length === 3) {
      geometry.setIndex([0, 1, 2]);
    }

    return geometry;
  }, [selectedVertices, shard.vertices]);

  return (
    <group>
      <mesh onClick={handlePlaneClick} rotation={[-Math.PI/2, 0, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {shard.vertices.map((vertex) => (
        <group key={vertex.id}>
          <mesh
            position={vertex.position}
            onPointerOver={() => handleVertexHover(vertex.id)}
            onPointerOut={() => handleVertexHover(null)}
            onClick={(e) => handleVertexClick(e, vertex.id)}
            onContextMenu={(e) => handleVertexRightClick(e, vertex.id)}
          >
            <sphereGeometry args={[0.1, 32, 32]} />
            <meshPhongMaterial color={selectedVertices.includes(vertex.id) ? COLORS.ORANGE : COLORS.PURPLE} />
          </mesh>
          <mesh
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
      {shard.faces.map((face) => (
        <mesh key={face.id}>
          <bufferGeometry>
            <bufferAttribute
              attachObject={['attributes', 'position']}
              array={new Float32Array(face.vertices.flatMap((id) => {
                const vertex = shard.vertices.find((v) => v.id === id);
                return vertex ? vertex.position : [0, 0, 0];
              }))}
              itemSize={3}
              count={face.vertices.length}
            />
          </bufferGeometry>
          <meshBasicMaterial color={COLORS.ORANGE} wireframe />
        </mesh>
      ))}
      {selectedFaceGeometry && (
        <line>
          <bufferGeometry attach="geometry" {...selectedFaceGeometry} />
          <lineBasicMaterial attach="material" color={COLORS.ORANGE} linewidth={2} />
        </line>
      )}
      <group onPointerMove={handleVertexDrag} onPointerUp={handleVertexDragEnd} />
      <VertexSelectionIndicator selectedVertices={selectedVertices} />
    </group>
  );
};

export default ShardEditor;