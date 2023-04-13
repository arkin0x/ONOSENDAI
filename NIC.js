// network interface controller

import { SimplePool } from 'nostr-tools'

const pool = new SimplePool()

const relays = [
 'wss://eden.nostr.land',
 'wss://nostr.fmt.wiz.biz',
 'wss://relay.damus.io',
 'wss://nostr-pub.wellorder.net',
 'wss://relay.nostr.info',
 'wss://offchain.pub',
 'wss://nos.lol',
 'wss://relay.snort.social',
 'wss://nostr.relayer.se',
]

export const kind0 = []
export const kind1 = []

const HOUR = 60 * 60 //3600 seconds

let cacheIntervals

init()

function init(){
 initializeCacheIntervals();
 processInterval();
}

/**
 * A cache interval is a pair of unix timestamps. The first timestamp is the `since` filter for a relay pool subscription; the `until` filter is `since` + 3600 (1 hour). The second timestamp is the most recent timestamp that events have been downloaded til which usually begins as the current timestamp when ONOSENDAI is first loaded; this timestamp does not change but serves as an anchor boundary on the interval. When the current subscription yields an EOSE, the first timestamp should be reduced by 1 hour (3600 seconds) and the subscription should be restarted with the `since` set to the first timestamp and the `until` filter set to `since` + 3600. If an EOSE is received and 0 events have been processed, then all events in history have been downloaded.
 * Whenever ONOSENDAI is booted up, there will be new events to download between now and the last time it was booted up. This represents a new interval. The new interval is [now - HOUR, now] and is appended to the cache-intervals array which is stored as a comma-delimited string in localstorage. The farthest-right (highest-index) cache interval is the first and only interval by which a new relay pool subscription is created. Once the first timestamp in the cache interval is reduced by 1 hour and ends up below the next lowest-index cache interval's 2nd timestamp, this interval will be complete and no longer run after it receives an EOSE.
 */

function initializeCacheIntervals() {
  const now = Math.floor(Date.now() / 1000);
  let newInterval;

  if (localStorage.getItem("cacheIntervals")) {
    cacheIntervals = localStorage
      .getItem("cacheIntervals")
      .split(",")
      .map(Number);

    const lastTimestamp = cacheIntervals[cacheIntervals.length - 1];

    if (now <= lastTimestamp) {
      // No new interval is created if now is less than or equal to the last timestamp
      return;
    } else if (now - HOUR <= lastTimestamp && now > lastTimestamp) {
      // If now - HOUR is less than or equal to the last timestamp but now is greater than the last timestamp
      newInterval = [lastTimestamp, lastTimestamp + HOUR];
    } else {
      newInterval = [now - HOUR, now];
    }
  } else {
    cacheIntervals = [];
    newInterval = [now - HOUR, now];
  }

  cacheIntervals.push(...newInterval);
  localStorage.setItem("cacheIntervals", cacheIntervals.join(","));
}

async function processInterval() {
  const rightmostIntervalIndex = cacheIntervals.length - 1;
  let intervalStart = cacheIntervals[rightmostIntervalIndex - 1];
  let intervalEnd = intervalStart + HOUR // the interval end is the start + 1 hour; the second number of the interval serves as a unmoving marker for where the interval started in the near-past, such that the difference between the second and first numbers is the total amount of time for which all events have been collected. The subscriptions are set up to collect 1 hour of events at a time and walk back the intervalstart after each EOSE.

  // Subscribe to the relay pool with the given since (intervalStart) and until (intervalEnd) filters
  // Wait for EOSE and count the number of events processed
  const eventCount = await subscribeToRelayPool(intervalStart, intervalEnd);

  // Check if we have reached beyond the very first nostr events and stop processing.
  if (eventCount === 0) {
    // increment emptyIntervals
    let emptyIntervals = Number(localStorage.getItem('emptyIntervals')) // will be 0 if Number(null)
    localStorage.setItem('emptyIntervals',emptyIntervals + 1)
    if(emptyIntervals > 24 * 7 * 4 ){
      // 1 month of no events
      console.log("All events in history have been downloaded.");
      return;
    }
  } else {
    localStorage.setItem('emptyIntervals',0)
  }

  // If the interval start is less than the previous interval's 2nd number, combine the intervals.
  // This indicates that all events between the two intervals have been downloaded into our DB.
  if (rightmostIntervalIndex > 1 && intervalStart < cacheIntervals[rightmostIntervalIndex - 2]) {
    // Combine intervals by removing the left interval's end and the right interval's start.
    cacheIntervals.splice(rightmostIntervalIndex - 2, 2);
  } else {
    // Step intervalStart backward 1 hour to collect more events
    intervalStart -= HOUR;
    cacheIntervals[rightmostIntervalIndex - 1] = intervalStart;
  }

  // Whatever is written to localStorage is considered "incomplete" or "what to do next" in case the app refreshes.
  localStorage.setItem("cacheIntervals", cacheIntervals.join(","));

  // Continue processing the rightmost cache interval
  processInterval();
}

async function subscribeToRelayPool(since, until) {
  return new Promise((resolve) => {
    let received = 0;
    let sub = pool.sub(relays, [{
      kinds: [0, 1],
      since,
      until,
    }]);

    sub.on('event', (event) => {
      received++;
      // Store event
      // console.log(event)
      // log event to array
      if(event.kind == 0) kind0.push(event)
      if(event.kind == 1) kind1.push(event)
    });

    sub.on('eose', () => {
      sub.unsub();
      resolve(received);
    });
  });
}
