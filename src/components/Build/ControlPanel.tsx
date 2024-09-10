import React from 'react';
import { useBuilderStore } from '../../store/BuilderStore'

interface ControlPanelProps {
  selectedTool: 'vertex' | 'face';
  setSelectedTool: (tool: 'vertex' | 'face') => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ selectedTool, setSelectedTool }) => {
  const { gridSize, setGridSize } = useBuilderStore();

  return (
    <div>
      <h3>Tools</h3>
      <button onClick={() => setSelectedTool('vertex')} disabled={selectedTool === 'vertex'}>
        Add Vertex
      </button>
      <button onClick={() => setSelectedTool('face')} disabled={selectedTool === 'face'}>
        Create Face
      </button>
      <h3>Grid Size</h3>
      <input
        type="number"
        value={gridSize}
        onChange={(e) => setGridSize(Number(e.target.value))}
        min={0.1}
        step={0.1}
      />
    </div>
  );
};

export default ControlPanel;