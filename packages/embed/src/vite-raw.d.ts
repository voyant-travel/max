// Vite/Vitest `?raw` imports return the file's contents as a string. Declared
// here so the loader behavioural test can inline `loader/max.js` without pulling
// in `@types/node` (which would force a lockfile change).
declare module "*?raw" {
  const contents: string
  export default contents
}
