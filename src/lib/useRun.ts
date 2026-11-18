import { useState } from 'react'

import { describeError } from './api'

// For one-off requests whose progress and failure only matter to the component that sent them.
export function useRun() {
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string>()
  async function run(task: () => Promise<unknown>) {
    setRunning(true)
    setMessage(undefined)
    try {
      await task()
    } catch (thrown) {
      setMessage(describeError(thrown))
    }
    setRunning(false)
  }
  return { running, message, run: (task: () => Promise<unknown>) => void run(task) }
}
