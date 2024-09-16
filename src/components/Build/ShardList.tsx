import React from 'react';
import { Shard } from './builderStore';

interface ShardListProps {
  shards: Shard[];
  currentShardId: string | null;
  onSelectShard: (id: string) => void;
}

const ShardList: React.FC<ShardListProps> = ({ shards, currentShardId, onSelectShard }) => {
  return (
    <div>
      <h3>Saved Shards</h3>
      <ul>
        {shards.map((shard) => (
          <li
            key={shard.id}
            onClick={() => onSelectShard(shard.id)}
            style={{ cursor: 'pointer', fontWeight: shard.id === currentShardId ? 'bold' : 'normal' }}
          >
            Shard {shard.id}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ShardList;