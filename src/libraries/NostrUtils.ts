export type FindTag = (tag: string[]) => boolean;

/**
 * Search a nostr event's tags for a particular tag. Useful for events with only one of the tag in question. Call event.tags.find(getTag('mytag')) to get the tag array starting with an element 'mytag'.
 * @param key string - the tag you are looking for
 * @returns boolean - true if the tag is found
 */
export const getTag = (key: string): FindTag => {
  return (tag): boolean => {
    return tag && Array.isArray(tag) && tag[0] === key
  }
}

/**
 * Search a nostr event's tags on the tag value and mark value. Useful for events with multiple of the same tag. Call event.tags.find(getTagValue('mytag', 'myvalue')) to get the tag array starting with an element 'mytag' and the second element 'myvalue'.
 * @param key string - the tag you are looking for
 * @param value string - the tag's first value to match
 * @returns boolean - true if the tag is found
 */
export const getTagMark = (key: string, value: string): FindTag => {
  return (tag): boolean => {
    return tag && Array.isArray(tag) && tag[0] === key && tag[1] === value
  }
}

/**
 * Search a nostr event's tags for a reference to a root event, indicating that this event is a reply. Call event.tags.find(getRoot()) to get the tag array starting with an element 'e' and the fourth element 'root'.
 * @returns boolean - true if the tag is found
 */
export const getTagRoot = (): FindTag => {
  return (tag): boolean => {
    return tag && Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'root' 
  }
}

export const getTagReply = (): FindTag => {
  return (tag): boolean => {
    return tag && Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply' 
  }
}
