// engine
// this is where work is done
import { kind0, kind1 } from './NIC'
import { storeEventBySectorAddress } from './STORAGE'
import { simhash, embedNumber3D, downscale } from './simhash'
import { WORLD_DOWNSCALE } from './ONOSENDAI'

let taskTimings

const TASK_TIMING_REDUCE = 1

/**
 * <verb><kind>
 * process: calculate, gather additional data, fetch requests, store in DB
 * visualize: load into world if contained within current sector/adjacent 
 */
const scanTasks = 'process0,process1,visualize0,visualize1'

taskTimings = {
 scan: {},
 burst: {
  castVortex: 0,
  castBubble: 0,
  castDerezz: 0,
  generateArmor: 0,
  generateStealth: 0,
  respondPOWChallenge: 0,
 },
 drive: {
  generatePOW: [0, 0, 0], // Array for different leading zeroes, 0 index is 1 leading zero.
 },
}

scanTasks.split(',').forEach(t => taskTimings.scan[t] = 0)

/**
 * Cycle through and perform each scan task until the scan task time budget is expended.
 * @param {Number} budget milliseconds (can be decimal)
 */
export function performScanTasks(budget) {
 // console.log('scan budget',budget)
 // redeclare this each iteration so that we start with the same prioritized tasks each frame.
 let tasks = scanTasks.split(',')

 // we detect if a task did not get its time recorded; this indicates
 // that the task was not run. This may have been for 2 reasons:
 // we simply ran out of time, or the previous time the task was run
 // it took an unusually long amount of time and now the estimate is too
 // high! If a task time is not recorded by the end of this function, we
 // reduce the task time slightly so that anomalous task timings don't stay
 // permanent and stop running altogether.
 let taskTimeRecorded = {}
 tasks.forEach(t => taskTimeRecorded[t] = false)

 // take current time
 let start = performance.now()

 // loop through tasks as long as this function stays under our time budget;
 // previous timings on tasks inform as to whether we can fit it into what is left of our time budget each iteration.
 while (performance.now() - start + taskTimings.scan[tasks[0]] < budget) {
  const task = tasks[0]
  switch (task) {
   case 'process0':
    // TODO
    process0()
    break
   case 'process1':
    process1()
    break
   default:
    break
  }

  // record timing
  taskTimings.scan[task] = performance.now() - start
  taskTimeRecorded[task] = true

  // loop to next task
  tasks.push(tasks.shift())
 }

 // adjust downward any task timings of tasks that did not get run
 for (const t in taskTimeRecorded) {
  if (taskTimeRecorded[t]) continue
  taskTimings.scan[t] = Math.max(0, taskTimings.scan[t] - TASK_TIMING_REDUCE)
  // if(t === 'requestNote') console.log('requestNote 👇')
 }
}

/**
 * calculate simhash/sector and store in database
 */
async function process0(){
 if (!kind0.length) return
 let event = kind0.shift()
 console.log(event)
 // let semanticHash = simhash(event.content)
 // let semanticCoordinate = embedNumber3D(semanticHash.hash)
 // let downscaledSemanticCoordinate = downscale(semanticCoordinate, WORLD_DOWNSCALE)
 // event.simhash = semanticHash.hex
 // event.coords = downscaledSemanticCoordinate
 // storeEventBySectorAddress(event)
}

async function process1(){
 if (!kind1.length) return
 let event = kind1.shift()
 let semanticHash = simhash(event.content)
 let semanticCoordinate = embedNumber3D(semanticHash.hash)
 let downscaledSemanticCoordinate = downscale(semanticCoordinate, WORLD_DOWNSCALE)
 event.simhash = semanticHash.hex
 event.coords = downscaledSemanticCoordinate
 storeEventBySectorAddress(event)
}