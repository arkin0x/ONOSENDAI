import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useBuilderStore } from '../../store/BuilderStore'
import Grid from './Grid'
import ShardEditor from './ShardEditor';
import ControlPanel from './ControlPanel';
import ShardList from './ShardList';
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import Shard from '../Cyberspace/Shard';
import { Vector3 } from 'three';
import { shardStateDataTo3DData } from './Shards';

const CyberspaceBuild: React.FC = () => {
  const { addShard, shardIndex, setCurrentShard, shards } = useBuilderStore();
  const [selectedTool, setSelectedTool] = useState<'vertex' | 'face'>('vertex');

  useEffect(() => {
    if (!shardIndex && shards.length === 0) {
      console.log('no shards!')
      addShard()
    }
  }, [shardIndex, shards, addShard]);

  return (
    <div style={{ height: '100vh', backgroundColor: "#14071f" }}>
      <Canvas camera={{ position: [0, 5, 10], far: 2**30 }}>
        <ambientLight intensity={2} />
        <Grid />
        {shardIndex && <ShardEditor shard={shards[shardIndex]} selectedTool={selectedTool} />}
        {shardIndex && <ShardList
          shards={shards}
          currentShardId={shardIndex}
          onSelectShard={(id) => setCurrentShard(id)}
        />}
        <ControlPanel selectedTool={selectedTool} setSelectedTool={setSelectedTool} />
        <EffectComposer>
          <Bloom mipmapBlur levels={9} intensity={5} luminanceThreshold={0} luminanceSmoothing={0} />
        </EffectComposer>
      </Canvas>
    </div>
  );
};

export default CyberspaceBuild;