/**
 * checkpoints.ts: block hashes this build KNOWS, independent of any server.
 *
 * The header blobs prove their own work, but proof of work alone only shows
 * that someone spent energy: a fabricated low-difficulty chain could satisfy
 * every structural rule. Pinning known mainnet block hashes into the source
 * makes that impossible past the pinned heights: a blob whose reconstruction
 * disagrees with an embedded checkpoint is discarded no matter what the
 * manifest says, so a compromised manifest host cannot substitute a chain.
 *
 * The manifest carries its own checkpoint list (the last block of each blob);
 * those are always enforced. Entries below are the second, stronger opinion,
 * verified wherever their height lands inside a blob.
 */

export interface Checkpoint {
  height: number
  /** Display-order (byte-reversed sha256d) block hash, 64 lowercase hex. */
  blockHash: string
}

/** The mainnet genesis block. */
export const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'

export const EMBEDDED_CHECKPOINTS: Checkpoint[] = [
  { height: 0, blockHash: GENESIS_HASH },
  // The final block of each published headers-v1 blob, pinned 2026-08-24;
  // every value independently confirmed against blockstream.info before
  // pinning, so the manifest host and this list are separate authorities.
  { height: 49999, blockHash: '000000000845517b31c6820d83f25cff46429bf136a7515fe504116427e60f8e' },
  { height: 99999, blockHash: '000000000002d01c1fccc21636b607dfd930d31d01c3a62104612a1719011250' },
  { height: 149999, blockHash: '00000000000008df4269884f1d3bfc2aed3ea747292abb89be3dc3faa8c5d26f' },
  { height: 199999, blockHash: '00000000000003a20def7a05a77361b9657ff954b2f2080e135ea6f5970da215' },
  { height: 249999, blockHash: '0000000000000009c2e82d884ec07b4aafb64ca3ef83baca2b6b0b5eb72c8f02' },
  { height: 299999, blockHash: '000000000000000067ecc744b5ae34eebbde14d21ca4db51652e4d67e155f07e' },
  { height: 349999, blockHash: '000000000000000002045664f89a1077d0c6c0aaa6dd89b485208cf92d6bbd30' },
  { height: 399999, blockHash: '0000000000000000030034b661aed920a9bdf6bbfa6d2e7a021f78481882fa39' },
  { height: 449999, blockHash: '0000000000000000024c4a35f0485bab79ce341cdd5cc6b15186d9b5b57bf3da' },
  { height: 499999, blockHash: '0000000000000000007962066dcd6675830883516bcf40047d42740a85eb2919' },
  { height: 549999, blockHash: '00000000000000000013dad60a42a3401a8f37ca02f1c00ac5923e674566a3ae' },
  { height: 599999, blockHash: '00000000000000000003ecd827f336c6971f6f77a0b9fba362398dd867975645' },
  { height: 649999, blockHash: '000000000000000000076c1eea129cec5a5291d0ee516c3305df33b0ba76ac51' },
  { height: 699999, blockHash: '0000000000000000000aa3ce000eb559f4143be419108134e0ce71042fc636eb' },
  { height: 749999, blockHash: '00000000000000000001e3aee44a04a5c3461181d25c8803ff6d617173e34533' },
  { height: 799999, blockHash: '000000000000000000012117ad9f72c1c0e42227c2d042dca23e6b96bd9fbb55' },
  { height: 849999, blockHash: '000000000000000000026b072f9347d86942f6786dd1fc362acfd9522715b313' },
  { height: 899999, blockHash: '0000000000000000000196400396be46d0816dc462df4c3450972f589f4d7d24' },
  { height: 949999, blockHash: '00000000000000000000df842728edc58cf64288ca21433257700f3d5b45f286' },
]
