import { simhash } from "../../../onosendai/archive/simhash.js"

// generate a random quaternion
function randomQuaternion() {
  const u1 = Math.random()
  const u2 = Math.random()
  const u3 = Math.random()

  const u1sqrt = Math.sqrt(u1)
  const u1m1sqrt = Math.sqrt(1 - u1)
  const x = u1m1sqrt * Math.sin(2 * Math.PI * u2)
  const y = u1m1sqrt * Math.cos(2 * Math.PI * u2)
  const z = u1sqrt * Math.sin(2 * Math.PI * u3)
  const w = u1sqrt * Math.cos(2 * Math.PI * u3)

  return [x, y, z, w]
}

const actions = ['drift', 'derezz', 'vortex', 'bubble', 'armor','stealth','noop']
function randomAction() {
  return actions[Math.floor(Math.random() * actions.length)]
}

// do 100 slightly different quaternions and see if we get 100 unique simhashes
// let count = 100
// const q1 = randomQuaternion()
// const action = randomAction()
// const dict = {}
// while(count--){
//   q1[3] += 0.0000000000000001
//   const hex = simhash(q1.join("\n")+'\n'+action).hex
//   dict[hex] = true
// }
// const vals = Object.keys(dict)
// console.log(dict, action, vals.length)

// try different actions to see the variation
const q2 = randomQuaternion()
const preimages = actions.map( a => q2.join("\n")+'\n'+a )
console.log(preimages.map( p => simhash(p).hex ))