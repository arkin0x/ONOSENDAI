import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useBuilderStore } from '../../store/BuilderStore'
import Grid from './Grid'
import ShardEditor from './ShardEditor';
import ControlPanel from './ControlPanel';
import ShardList from './ShardList';

const CyberspaceBuild: React.FC = () => {
  const { addShard, currentShard, setCurrentShard, shards } = useBuilderStore();
  const [selectedTool, setSelectedTool] = useState<'vertex' | 'face'>('vertex');

  useEffect(() => {
    if (!currentShard && shards.length === 0) {
      addShard();
    }
  }, [currentShard, shards, addShard]);

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: "#222222" }}>
      <div style={{ flex: 1 }}>
        <Canvas camera={{ position: [0, 5, 10], far: 2**30 }}>
          <ambientLight intensity={2} />
          <pointLight position={[10, 10, 10]} />
          <Grid />
          {currentShard && <ShardEditor shard={currentShard} selectedTool={selectedTool} />}
          <OrbitControls />
        </Canvas>
      </div>
      <div style={{ width: '300px', padding: '20px', background: '#444444' }}>
        <ControlPanel
          selectedTool={selectedTool}
          setSelectedTool={setSelectedTool}
        />
        <ShardList
          shards={shards}
          currentShardId={currentShard?.id ?? null}
          onSelectShard={(id) => setCurrentShard(id)}
        />
      </div>
    </div>
  );
};

export default CyberspaceBuild