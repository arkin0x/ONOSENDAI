import { getSector } from "./ONOSENDAI";

// storage
let db

export async function getEventsBySectorAddress(sectorAddress, lastEventId, count = 10) {
 if (!db) {
  await initializeDB();
 }

 return new Promise((resolve, reject) => {
  const transaction = db.transaction(["events","kind0Events"], "readonly");
  const objectStore = transaction.objectStore("events");
  const index = objectStore.index("sectorAddress");

  // Use a key range to filter events by sectorAddress
  const keyRange = IDBKeyRange.only(sectorAddress);

  const request = index.openCursor(keyRange, "next");
  const events = [];
  let lastSeenId;

  request.onsuccess = (event) => {
   const cursor = event.target.result;
   if (cursor) {
    // If we have already seen the lastEventId, start collecting events
    if (lastSeenId === lastEventId || lastEventId === undefined) {
     events.push(cursor.value);

     // If we have collected the desired number of events, resolve the promise
     if (events.length >= count) {
      resolve({ events, lastEventId: cursor.primaryKey });
      return;
     }
    } else if (cursor.primaryKey === lastEventId) {
     // We have found the lastEventId, set the flag
     lastSeenId = lastEventId;
    }

    // Move to the next event in the index
    cursor.continue();
   } else {
    // No more events in the index, resolve with the events found
    resolve({ events, lastEventId: lastSeenId });
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
