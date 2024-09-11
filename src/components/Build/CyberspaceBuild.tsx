import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useBuilderStore } from '../../store/BuilderStore'
import Grid from './Grid'
import ShardEditor from './ShardEditor';
import ControlPanel from './ControlPanel';
import ShardList from './ShardList';
import { Bloom, EffectComposer } from '@react-three/postprocessing'

const CyberspaceBuild: React.FC = () => {
  const { addShard, currentShard, setCurrentShard, shards } = useBuilderStore();
  const [selectedTool, setSelectedTool] = useState<'vertex' | 'face'>('vertex');

  useEffect(() => {
    if (!currentShard && shards.length === 0) {
      addShard()
    }
  }, [currentShard, shards, addShard]);

  return (
    <div style={{ height: '100vh', backgroundColor: "#14071f" }}>
      <Canvas camera={{ position: [0, 5, 10], far: 2**30 }}>
        <ambientLight intensity={2} />
        <Grid />
        {currentShard && <ShardEditor shard={currentShard} selectedTool={selectedTool} />}
        <ControlPanel selectedTool={selectedTool} setSelectedTool={setSelectedTool} />
        <OrbitControls />
        <EffectComposer>
          <Bloom mipmapBlur levels={9} intensity={5} luminanceThreshold={0} luminanceSmoothing={0} />
        </EffectComposer>
      </Canvas>
      <div style={{ position: 'absolute', top: 0, right: 0, width: '200px', padding: '20px', background: '#0a030f', color: "#ffffff" }}>
        <ShardList
          shards={shards}
          currentShardId={currentShard?.id ?? null}
          onSelectShard={(id) => setCurrentShard(id)}
        />
      </div>
    </div>
  );
};

export default CyberspaceBuild;