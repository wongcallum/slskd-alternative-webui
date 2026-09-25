import { useState } from 'react'

import { describeError } from './api'

// For one-off requests whose progress and error only matter to the component that sent them.
export function useRun() {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()
  async function run(task: () => Promise<unknown>) {
    setRunning(true)
    setError(undefined)
    try {
      await task()
    } catch (thrown) {
      setError(describeError(thrown))
    }
    setRunning(false)
  }
  return { running, error, run: (task: () => Promise<unknown>) => void run(task) }
}
