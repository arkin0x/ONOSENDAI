import React from 'react'
import { useBuilderStore } from '../../store/BuilderStore'
import COLORS from '../../data/Colors'

const Grid: React.FC = () => {
  const gridSize = useBuilderStore((state) => state.gridSize)

  return (
    <gridHelper args={[gridSize, gridSize, COLORS.ORANGE, COLORS.PURPLE]} />
  )
}

export default Grid