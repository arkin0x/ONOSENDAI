// Action.ts

export const actionTypes = new Set<string>([
  "drift",
  "derezz",
  "vortex",
  "bubble",
  "armor",
  "stealth",
  "noop",
])

export const firstDrift = {
  "kind": 333,
  "tags": [
    ["ms", "<created_at ms>"],
    ["C", "<pubkey or simhash of nip-05>"],
    ["quaternion", "<x>", "<y>", "<z>", "<w>"],
    ["velocity", "0", "0", "0"],
    ["nonce", "0", "<target>"],
    ["A", "drift"],
    ["version", "1"]
  ]
}

