import React from 'react';
import { useBuilderStore } from '../../store/BuilderStore'

const Grid: React.FC = () => {
  const gridSize = useBuilderStore((state) => state.gridSize);

  return (
    <gridHelper args={[gridSize, gridSize, 0x444444, 0x888888]} />
  );
};

export default Grid;