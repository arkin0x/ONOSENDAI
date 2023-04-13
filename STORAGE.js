import { getSector } from "./ONOSENDAI";

// storage
let db

export async function storeEventBySectorAddress(event) {
 if (!db) {
  await initializeDB();
 }

 const [x, y, z] = event.coords;
 const sector = getSector(x, y, z)
 const sectorAddress = sector.address
 const storeEvent = { ...event, sectorAddress }

 return new Promise((resolve, reject) => {
  const transaction = db.transaction(["events"], "readwrite");
  const objectStore = transaction.objectStore("events");
  const request = objectStore.put(storeEvent);

  request.onsuccess = () => {
   console.log('event cached')
   resolve();
  };

  request.onerror = () => {
   reject(request.error);
  };
 });
}

export async function getEventsBySectorAddress(sectorAddress, lastEventId, count = 10) {
 if (!db) {
  await initializeDB();
 }

 return new Promise((resolve, reject) => {
  const transaction = db.transaction(["events"], "readonly");
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
  const openRequest = indexedDB.open("NostrEventsDB", 3);

  openRequest.onupgradeneeded = (event) => {
   const db = event.target.result;
   if (!db.objectStoreNames.contains("events")) {
    const objectStore = db.createObjectStore("events", { keyPath: "id" });
    objectStore.createIndex("sectorAddress", "sectorAddress", { unique: false });
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