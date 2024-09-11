import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import COLORS from '../../data/Colors';

interface VertexSelectionIndicatorProps {
  selectedVertices: string[];
}

const VertexSelectionIndicator: React.FC<VertexSelectionIndicatorProps> = ({ selectedVertices }) => {
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (groupRef.current) {
      const cameraPosition = camera.position.clone();
      // const offset = new Vector3(1.25, -2.25, -5);
      const offset = new Vector3(.04, -.09, -.2);
      offset.applyQuaternion(camera.quaternion);
      groupRef.current.position.copy(cameraPosition.add(offset));
      groupRef.current.quaternion.copy(camera.quaternion);
      const SCALAR = 0.03
      const scale = new Vector3(SCALAR, SCALAR, SCALAR)
      groupRef.current.scale.copy(scale);
      // Rotate 90 degrees counterclockwise on the Z axis
      // groupRef.current.rotation.z += Math.PI / 2
    }
  });

  return (
    <group ref={groupRef}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[
          Math.cos(i * (2 * Math.PI / 3)) * 0.3,
          Math.sin(i * (2 * Math.PI / 3)) * 0.3,
          0
        ]}>
          <sphereGeometry args={[0.1, 32, 32]} />
          <meshBasicMaterial color={i < selectedVertices.length ? COLORS.ORANGE : COLORS.BLACK} />
        </mesh>
      ))}
    </group>
  );
};

export default VertexSelectionIndicator;