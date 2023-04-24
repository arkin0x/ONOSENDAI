import { getSector } from "./ONOSENDAI";

// storage
let db

// getEventsBySectorAddress now takes an extra parameter 'offset'
export async function getEventsBySectorAddress(sectorAddress, offset = 0, count = 10) {
  if (!db) {
    await initializeDB();
  }

  return new Promise(async (resolve, reject) => {
    const kind1Transaction = db.transaction(["events"], "readonly");
    const kind1ObjectStore = kind1Transaction.objectStore("events");
    const kind1Index = kind1ObjectStore.index("sectorAddress");

    const kind0Transaction = db.transaction(["kind0Events"], "readonly");
    const kind0ObjectStore = kind0Transaction.objectStore("kind0Events");
    const kind0Index = kind0ObjectStore.index("sectorAddress");

    // Use a key range to filter events by sectorAddress
    const keyRange = IDBKeyRange.only(sectorAddress);

    const kind1Events = await getAllEventsFromIndex(kind1Index, keyRange, offset, count);
    const kind0Events = await getAllEventsFromIndex(kind0Index, keyRange, offset, count);

    const events = kind1Events.events.concat(kind0Events.events);

    const hasMoreEvents = kind1Events.hasMoreEvents || kind0Events.hasMoreEvents;

    resolve({ events, hasMoreEvents });
  });
}

async function getAllEventsFromIndex(index, keyRange, offset, count) {
  return new Promise((resolve, reject) => {
    const request = index.openCursor(keyRange, "next");
    const events = [];
    let skipped = 0;
    let hasMoreEvents = false;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (skipped < offset) {
          // Skip events until we reach the desired offset
          skipped++;
        } else {
          // Start collecting events
          events.push(cursor.value);

          // If we have collected the desired number of events, resolve the promise
          if (events.length >= count) {
            hasMoreEvents = true;
            resolve({ events, hasMoreEvents });
            return;
          }
        }

        // Move to the next event in the index
        cursor.continue();
      } else {
        // No more events in the index, resolve with the events found
        resolve({ events, hasMoreEvents });
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function initializeDB() {
 return new Promise((resolve, reject) => {
  const openRequest = indexedDB.open("NostrEventsDB", 4); // Increment the version number

  openRequest.onupgradeneeded = (event) => {
   const db = event.target.result;

   if (!db.objectStoreNames.contains("events")) {
    const objectStore = db.createObjectStore("events", { keyPath: "id" });
    objectStore.createIndex("sectorAddress", "sectorAddress", { unique: false });
   }

   // Create a separate object store for kind0 events
   if (!db.objectStoreNames.contains("kind0Events")) {
    const kind0ObjectStore = db.createObjectStore("kind0Events", { keyPath: "pubkey" });
   }
  };

  openRequest.onsuccess = (event) => {
   db = event.target.result;
   resolve(db);
  };

  openRequest.onerror = (event) => {
   reject(event.target.error);
  };
 });
}

export async function storeEventBySectorAddress(event) {
 if (!db) {
  await initializeDB();
 }

 const [x, y, z] = event.coords;
 const sector = getSector(x, y, z);
 const sectorAddress = sector.address;

 if (event.kind === 0) {
  const existingEvent = await getKind0EventByPubkey(event.pubkey);
  if (existingEvent && existingEvent.created_at >= event.created_at) {
   // The event in the database is newer or the same, so we don't need to store the incoming event
   return;
  }
 }

 const storeEvent = { ...event, sectorAddress };

 return new Promise((resolve, reject) => {
  const transaction = db.transaction(["events", "kind0Events"], "readwrite");

  // Choose the object store based on the event kind
  const objectStore =
   event.kind === 0
    ? transaction.objectStore("kind0Events")
    : transaction.objectStore("events");

  const request = objectStore.put(storeEvent);

  request.onsuccess = () => {
   console.log("event cached");
   resolve();
  };

  request.onerror = () => {
   reject(request.error);
  };
 });
}

async function getKind0EventByPubkey(pubkey) {
  if (!db) {
    await initializeDB();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["kind0Events"], "readonly");
    const objectStore = transaction.objectStore("kind0Events");
    const index = objectStore.index("pubkey");

    const request = index.get(pubkey);

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}
