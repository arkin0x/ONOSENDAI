import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const Shard = ({ shardData }) => {

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(shardData.vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(shardData.colors, 3));
    geo.setIndex(shardData.indices);
    geo.computeVertexNormals();
    return geo;
  }, [shardData]);

  const position = useMemo(() => {
    const x = parseInt(shardData.position.x);
    const y = parseInt(shardData.position.y);
    const z = parseInt(shardData.position.z);
    return new THREE.Vector3(x, y, z);
  }, [shardData.position]);

  return (
      <mesh geometry={geometry} position={position}>
        <meshPhongMaterial vertexColors={true} side={THREE.DoubleSide} />
      </mesh>
    )
}

export default Shard