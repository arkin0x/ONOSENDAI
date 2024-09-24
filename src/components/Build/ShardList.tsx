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
}

function ShardList({shards}: ShardListProps) {
  const { addShard, setGridSize, setCurrentShard, deleteShard} = useBuilderStore();
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

  function handleClick(event, shard) {
    event.stopPropagation();
    if (event.button === 0) {
      setCurrentShard(shard.id)
    }
    if (event.button === 2) {
      const shouldDelete = confirm('Delete this shard?')
      if (shouldDelete) {
        deleteShard(shard.id)
      }
    }
  }

  function shardList() {
    const position = new Vector3(5, 0.5, 0)
    const positionOffset = new Vector3(0, -5, 0)
    function incrementPosition () {
      return position.add(positionOffset).clone()
    }
    const list = shards.map((shard) => (
      <group rotation={[Math.PI/4, 0, 0]} position={incrementPosition()} key={shard.id} onClick={(e) => handleClick(e, shard)} onContextMenu={(e) => handleClick(e, shard)}>
        <Shard shardData={shardStateDataTo3DData(shard)}/>
        <Text 
          color={COLORS.ORANGE} 
          fontSize={0.5} 
          font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
          textAlign='center'
          anchorX={'right'}
          position={[-shard.gridSize/2, 0, 0]} 
          rotation={[-Math.PI/4, 0, 0]}
        >
          SHARD {shard.id}
        </Text>
        <gridHelper args={[shard.gridSize, shard.gridSize, COLORS.ORANGE, COLORS.PURPLE]} />
      </group>
    ))
    list.push((
      <group scale={[10,10,10]} position={incrementPosition()}>
        <mesh
          position={[0, 0, 0]}
          onClick={() => addShard()}
        >
          <boxGeometry args={[0.5, 0.2, 0.1]} />
          <meshBasicMaterial color={COLORS.ORANGE} />
        </mesh>
        <Text position={[0, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
          CREATE
        </Text>
      </group>
    ))
    return list
  }


  return (
    <group ref={groupRef} rotation={[Math.PI/4, 0, 0]}>
      {shardList()}
    </group>
  );
};

export default ShardList;