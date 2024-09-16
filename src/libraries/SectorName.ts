const adjectives = [
  'Cosmic', 'Neon', 'Quantum', 'Cyber', 'Binary', 'Virtual', 'Hyper', 'Nano', 'Critical', 'Abstract',
  'Golden', 'Infinite', 'Dark', 'Electric', 'Lunar', 'Solar', 'Astral', 'Eternal', 'Caustic', 'Lost'
]
const nouns = [
  'Grid', 'Node', 'Nexus', 'Vortex', 'Matrix', 'Pulse', 'Core', 'Sphere', 'Prism', 'Flux', 
  'Axiom', 'Orbit', 'Portal', 'Cluster', 'Array', 'Field', 'Replicant', 'Index', 'Aura', 'Conduit'
]
const suffixes = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Nil', 'Theta', 'Iota', 'Kappa', 
  'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon'
]

export function generateSectorName(sectorId) {
  const [x, y, z] = sectorId.split('-').map(BigInt);
  
  const adjIndex = Number(x % BigInt(adjectives.length));
  const nounIndex = Number(y % BigInt(nouns.length));
  const suffixIndex = Number(z % BigInt(suffixes.length));
  
  const name = `${adjectives[adjIndex]} ${nouns[nounIndex]} ${suffixes[suffixIndex]}`;
  
  // Generate a short numeric code based on the last few digits of each coordinate
  const shortCode = sectorId.split('-').map(coord => coord.slice(-4)).join('-');
  
  return `${name} (${shortCode})`;
}

// Example usage
// const sectorId = "32646443070356590-11145888365145142-15069409405917810";
// console.log(generateSectorName(sectorId));