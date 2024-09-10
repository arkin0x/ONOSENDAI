export const shardData = {
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
    2, 4, 3
  ],
  colors: [
    1, 0, 0,  // red
    1, 0, 0,  // green
    1, 0, 1,  // blue
    0, 0, 1,  // yellow
    1, 0, 1   // magenta
  ],
  position: { // in the sector
    x: 1,
    y: 2,
    z: 3
  }
}