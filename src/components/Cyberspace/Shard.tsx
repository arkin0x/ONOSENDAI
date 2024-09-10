import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

const Shard = ({ shardData }) => {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    
    // Add vertices
    geo.setAttribute('position', new THREE.Float32BufferAttribute(shardData.vertices, 3));
    
    // Add colors
    geo.setAttribute('color', new THREE.Float32BufferAttribute(shardData.colors, 3));
    
    // Add faces
    geo.setIndex(shardData.indices);
    
    geo.computeVertexNormals();
    return geo;
  }, [shardData]);

  return (
    <mesh geometry={geometry}>
      <meshPhongMaterial vertexColors={true} side={THREE.DoubleSide} />
    </mesh>
  );
};

const ShardViewer = ({ shardData }) => {
  return (
      <Shard shardData={shardData} />
  )
}

export default ShardViewer