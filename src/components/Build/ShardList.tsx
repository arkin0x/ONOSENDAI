import React, { useEffect, useRef } from 'react';
import { Text } from '@react-three/drei';
import { CyberspaceShard, useBuilderStore } from '../../store/BuilderStore';
import COLORS from '../../data/Colors';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { shardStateDataTo3DData } from './Shards';
import { Shard } from '../Cyberspace/Shard';

interface ShardListProps {
  shards: CyberspaceShard[]
  currentShardId: number
  onSelectShard: (id: string | null) => void
}

function ShardList({shards, onSelectShard}: ShardListProps) {
  const { gridSize, setGridSize, setCurrentShard } = useBuilderStore();
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();

  useEffect(() => {
    setGridSize(3)
  }, [setGridSize])

  useFrame(() => {
    if (groupRef.current) {
      const cameraPosition = camera.position.clone();
      const offset = new Vector3(0.125, .1, -.2);
      offset.applyQuaternion(camera.quaternion);
      groupRef.current.position.copy(cameraPosition.add(offset));
      groupRef.current.quaternion.copy(camera.quaternion);
      const SCALAR = 0.005
      const scale = new Vector3(SCALAR, SCALAR, SCALAR)
      groupRef.current.scale.copy(scale);
    }
  });

  function shardList() {
    const position = new Vector3(1,0,0)
    return shards.map((shard) => (
      <group position={position} key={shard.id} onClick={() => setCurrentShard(shard.id)}>
        <Shard shardData={shardStateDataTo3DData(shard)}/>
        <Text 
          color={COLORS.ORANGE} 
          fontSize={0.5} 
          font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
          textAlign='center'
          anchorX={'center'}
          position={[0, -0.5, 0]} 
        >
          SHARD {shard.id}
        </Text>
      </group>
    ))
  }


  return (
    <group ref={groupRef}>
      <gridHelper args={[gridSize, gridSize, COLORS.ORANGE, COLORS.PURPLE]} />
      {shardList()}
    </group>
  );
};

export default ShardList;