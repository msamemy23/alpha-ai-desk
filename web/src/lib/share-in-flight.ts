// Wraps a loader so that callers who ask while a load is already running share that one load.
// Nothing is kept once it answers (or fails), so the next call always reads fresh data.
export function shareInFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null
  return () => {
    if (running) return running
    const run = load()
    running = run
    const done = () => { if (running === run) running = null }
    run.then(done, done)
    return run
  }
}
