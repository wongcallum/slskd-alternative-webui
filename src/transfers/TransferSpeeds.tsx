import { ArrowDownIcon, ArrowUpIcon } from '@radix-ui/react-icons'
import { Button, Flex, Tooltip } from '@radix-ui/themes'
import { Link } from '@tanstack/react-router'

import { formatSpeed } from '../lib/format'
import { useTransferFigures } from './figures'
import type { Direction } from './transfers'

const directions = {
  download: { to: '/downloads', Icon: ArrowDownIcon, label: 'Download speed' },
  upload: { to: '/uploads', Icon: ArrowUpIcon, label: 'Upload speed' },
} as const

type Speed = { text: string; idle: boolean; summary: string }

function useSpeed(direction: Direction): Speed {
  const { exact, counts, speed } = useTransferFigures(direction)
  const summary =
    counts === undefined
      ? directions[direction].label
      : counts.running + counts.queued === 0
        ? `Nothing ${direction}ing or queued`
        : `${exact ? '' : 'About '}${counts.running.toLocaleString()} ${direction}ing and ${counts.queued.toLocaleString()} queued`
  return { text: speed === undefined ? '–' : formatSpeed(speed), idle: speed === undefined || speed === 0, summary }
}

function Value({ direction, speed }: { direction: Direction; speed: Speed }) {
  const { Icon } = directions[direction]
  return (
    <Flex as="span" align="center" gap="1" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <Icon />
      <span style={{ color: speed.idle ? 'var(--gray-a9)' : undefined }}>{speed.text}</span>
    </Flex>
  )
}

export function SpeedValue({ direction }: { direction: Direction }) {
  return <Value direction={direction} speed={useSpeed(direction)} />
}

function BarSpeed({ direction }: { direction: Direction }) {
  const speed = useSpeed(direction)
  const { to, label } = directions[direction]
  return (
    <Tooltip content={speed.summary}>
      <Button asChild variant="ghost" color="gray">
        <Link to={to} aria-label={`${label}: ${speed.text}`}>
          <Value direction={direction} speed={speed} />
        </Link>
      </Button>
    </Tooltip>
  )
}

export function TransferSpeeds() {
  return (
    <Flex align="center" gap="4">
      <BarSpeed direction="download" />
      <BarSpeed direction="upload" />
    </Flex>
  )
}
