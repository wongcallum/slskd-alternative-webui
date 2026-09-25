import { PauseIcon, PlayIcon } from '@radix-ui/react-icons'
import { Button, Tooltip } from '@radix-ui/themes'
import { type UIEvent, useRef, useState } from 'react'

// A list with the newest rows on top holds still while it's scrolled down or paused, so reading isn't disturbed by
// rows arriving at the top. The marker is whatever the list needs to tell the rows it held from the new ones.
export function useHold<M>(capture: () => M) {
  const [hold, setHold] = useState<{ marker: M; paused: boolean }>()
  const scrollRef = useRef<HTMLDivElement>(null)

  const freeze = (paused: boolean) =>
    setHold((current) => ({ marker: current === undefined ? capture() : current.marker, paused }))

  return {
    marker: hold?.marker,
    held: hold !== undefined,
    scrollRef,
    pause: () => freeze(true),
    resume: () => {
      setHold(undefined)
      scrollRef.current?.scrollTo({ top: 0 })
    },
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      const away = event.currentTarget.scrollTop >= 1
      if (away && hold === undefined) freeze(false)
      else if (!away && hold?.paused === false) setHold(undefined)
    },
    // Without the list there's nothing to scroll back up. Called while rendering.
    releaseIfEmpty: (empty: boolean) => {
      if (empty && hold?.paused === false) setHold(undefined)
    },
  }
}

export function HoldButton({
  held,
  unseen,
  onPause,
  onResume,
}: {
  held: boolean
  unseen: string
  onPause: () => void
  onResume: () => void
}) {
  if (held) {
    return (
      <Button size="1" variant="soft" onClick={onResume}>
        <PlayIcon />
        Resume{unseen}
      </Button>
    )
  }
  return (
    <Tooltip content="Hold the list still. Scrolling down does too.">
      <Button size="1" variant="soft" color="gray" onClick={onPause}>
        <PauseIcon />
        Pause
      </Button>
    </Tooltip>
  )
}
