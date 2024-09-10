import React, { useRef } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Shard, useBuilderStore } from '../../store/BuilderStore'

interface ShardEditorProps {
  shard: Shard;
  selectedTool: 'vertex' | 'face';
}

const ShardEditor: React.FC<ShardEditorProps> = ({ shard, selectedTool }) => {
  const { addVertex, updateVertex, addFace } = useBuilderStore();
  const { scene, camera } = useThree();

  const handlePlaneClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectedTool === 'vertex') {
      const { point } = event.intersections[0];
      addVertex([point.x, point.y, point.z], [1, 1, 1]); // Default white color
    }
  };

  const handleVertexDrag = (id: string, newPosition: [number, number, number]) => {
    updateVertex(id, newPosition, [1, 1, 1]); // Maintain the current color
  };

  const handleFaceCreation = (vertexIds: string[]) => {
    if (vertexIds.length >= 3) {
      addFace(vertexIds);
    }
  };

  return (
    <group>
      <mesh onClick={handlePlaneClick}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {shard.vertices.map((vertex) => (
        <mesh
          key={vertex.id}
          position={vertex.position}
          onClick={(e) => {
            e.stopPropagation();
            if (selectedTool === 'face') {
              // Handle vertex selection for face creation
            }
          }}
        >
          <sphereGeometry args={[0.1, 32, 32]} />
          <meshBasicMaterial color={`rgb(${vertex.color.join(',')})`} />
        </mesh>
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
          <meshBasicMaterial color={0xffffff} wireframe />
        </mesh>
      ))}
    </group>
  );
};

export default ShardEditor;