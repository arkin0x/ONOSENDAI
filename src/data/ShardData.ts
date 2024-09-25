import { Shard3DData } from "../components/Build/Shards";

export const shardData: Shard3DData = {
  vertices: [
    0, 1, 0,    // top point
    -1, -1, 1,  // base point 1
    1, -1, 1,   // base point 2
    1, -1, -1,  // base point 3
    -1, -1, -1  // base point 4
  ],
  indices: [
    0, 1, 2,
    0, 2, 3,
    0, 3, 4,
    0, 4, 1,
    1, 4, 2,
    2, 4, 3,
    2, 1, 4,
  ],
  colors: [
    1, 0, 0,  // red
    0, 1, 0,  // green
    0, 0, 1,  // blue
    1, 0, 1,  // yellow
    0, 1, 1   // magenta
  ],
  position: { // in the sector
    x: 1,
    y: 2,
    z: 3
  },
  display: "wireframe" // "solid", "wireframe", "points"
}