import React from 'react'
import { Event } from 'nostr-tools'
import Shard from './Cyberspace/Shard'
import { parseShard3DDataFromEvent } from '../libraries/ShardUtils'

interface ShardRendererProps {
  event: Event
}

const ShardRenderer: React.FC<ShardRendererProps> = ({ event }) => {
  const shardData = parseShard3DDataFromEvent(event)

  if (!shardData) {
    console.error('Failed to parse shard data from event:', event)
    return null
  }

  return <Shard shardData={shardData} />
}

export default ShardRenderer