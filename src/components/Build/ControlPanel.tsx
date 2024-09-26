import React, { useEffect, useRef } from 'react';
import { Text } from '@react-three/drei';
import { useBuilderStore } from '../../store/BuilderStore';
import COLORS from '../../data/Colors';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';

interface ControlPanelProps {
  selectedTool: 'vertex' | 'face' | 'color' | 'move';
  setSelectedTool: (tool: 'vertex' | 'face' | 'color' | 'move') => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ selectedTool, setSelectedTool }) => {
  const { gridSize, setGridSize } = useBuilderStore();
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();

  useEffect(() => {
    setGridSize(3)
  }, [setGridSize])

  useFrame(() => {
    if (groupRef.current) {
      const cameraPosition = camera.position.clone();
      const offset = new Vector3(0, -.1, -.2);
      offset.applyQuaternion(camera.quaternion);
      groupRef.current.position.copy(cameraPosition.add(offset));
      groupRef.current.quaternion.copy(camera.quaternion);
      const SCALAR = 0.05
      const scale = new Vector3(SCALAR, SCALAR, SCALAR)
      groupRef.current.scale.copy(scale);
    }
  });

  return (
    <group ref={groupRef}>
      <Text position={[0, 0.5, 0]} color={COLORS.ORANGE} fontSize={0.15} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
        SHARD TOOLS
      </Text>
      <group position={[0, 0.2, 0]}>

        <mesh
          position={[-0.9, 0, 0]}
          onClick={() => setSelectedTool('vertex')}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={selectedTool === 'vertex' ? COLORS.ORANGE : COLORS.PURPLE} />
        </mesh>
        <Text position={[-0.9, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          VERTEX
        </Text>

        <mesh
          position={[-0.3, 0, 0]}
          onClick={() => setSelectedTool('move')}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={selectedTool === 'move' ? COLORS.ORANGE : COLORS.PURPLE} />
        </mesh>
        <Text position={[-0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          MOVE 
        </Text>

        <mesh
          position={[0.3, 0, 0]}
          onClick={() => setSelectedTool('color')}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={selectedTool === 'color' ? COLORS.ORANGE : COLORS.PURPLE} />
        </mesh>
        <Text position={[0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          COLOR 
        </Text>

        <mesh
          position={[0.9, 0, 0]}
          onClick={() => setSelectedTool('face')}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={selectedTool === 'face' ? COLORS.ORANGE : COLORS.PURPLE} />
        </mesh>
        <Text position={[0.9, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          FACE
        </Text>

      </group>

      <Text position={[0, -0.3, 0]} color={COLORS.ORANGE} fontSize={0.15} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
        GRID SIZE {gridSize.toFixed(1)}
      </Text>

      <group position={[0, -.6, 0]}>
        <group position={[-0.15, 0, 0]}>
          <mesh
            position={[0, 0, 0]}
            onClick={() => setGridSize(Math.max(0.1, gridSize - 1))}
          >
            <boxGeometry args={[0.2, 0.2, 0.1]} />
            <meshBasicMaterial color={COLORS.PURPLE} />
          </mesh>
          <Text position={[0, 0, 0.07]} color={COLORS.BLACK} fontSize={0.12} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
            -
          </Text>
        </group>
        <group position={[.15, 0, 0]}>
          <mesh
            position={[0, 0, 0]}
            onClick={() => setGridSize(gridSize + 1)}
          >
            <boxGeometry args={[0.2, 0.2, 0.1]} />
            <meshBasicMaterial color={COLORS.PURPLE} />
          </mesh>
          <Text position={[0, 0, 0.07]} color={COLORS.BLACK} fontSize={0.12} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
            +
          </Text>
        </group>
      </group>
    </group>
  );
};

export default ControlPanel;