import React from 'react';
import { Text } from '@react-three/drei';
import { useBuilderStore } from '../../store/BuilderStore';
import COLORS from '../../data/Colors';

interface ControlPanelProps {
  selectedTool: 'vertex' | 'face';
  setSelectedTool: (tool: 'vertex' | 'face') => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ selectedTool, setSelectedTool }) => {
  const { gridSize, setGridSize } = useBuilderStore();

  return (
    <group position={[-1.5, 0, 0]}>
      <Text position={[0, 0.5, 0]} color={COLORS.ORANGE} fontSize={0.15}>
        Tools
      </Text>
      <group position={[0, 0.2, 0]}>
        <mesh
          position={[-0.3, 0, 0]}
          onClick={() => setSelectedTool('vertex')}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={selectedTool === 'vertex' ? COLORS.ORANGE : COLORS.PURPLE} />
        </mesh>
        <Text position={[-0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08}>
          Vertex
        </Text>
        <mesh
          position={[0.3, 0, 0]}
          onClick={() => setSelectedTool('face')}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={selectedTool === 'face' ? COLORS.ORANGE : COLORS.PURPLE} />
        </mesh>
        <Text position={[0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08}>
          Face
        </Text>
      </group>
      <Text position={[0, -0.3, 0]} color={COLORS.ORANGE} fontSize={0.15}>
        Grid Size: {gridSize.toFixed(1)}
      </Text>
      <group position={[0, -0.5, 0]}>
        <mesh
          position={[-0.3, 0, 0]}
          onClick={() => setGridSize(Math.max(0.1, gridSize - 0.1))}
        >
          <boxGeometry args={[0.2, 0.2, 0.1]} />
          <meshBasicMaterial color={COLORS.PURPLE} />
        </mesh>
        <Text position={[-0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.12}>
          -
        </Text>
        <mesh
          position={[0.3, 0, 0]}
          onClick={() => setGridSize(gridSize + 0.1)}
        >
          <boxGeometry args={[0.2, 0.2, 0.1]} />
          <meshBasicMaterial color={COLORS.PURPLE} />
        </mesh>
        <Text position={[0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.12}>
          +
        </Text>
      </group>
    </group>
  );
};

export default ControlPanel;