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

function Speed({ direction }: { direction: Direction }) {
  const { exact, counts, speed } = useTransferFigures(direction)
  const { to, Icon, label } = directions[direction]
  const text = speed === undefined ? '–' : formatSpeed(speed)
  const tooltip =
    counts === undefined
      ? label
      : `${exact ? '' : 'About '}${counts.running.toLocaleString()} ${direction}ing and ${counts.queued.toLocaleString()} queued`
  return (
    <Tooltip content={tooltip}>
      <Button asChild variant="ghost" color="gray" style={{ justifyContent: 'start' }}>
        <Link to={to} aria-label={`${label}: ${text}`}>
          <Icon />
          <span
            style={{
              // Fits "1023.9 KiB/s", so a changing speed doesn't move the Soulseek indicator.
              minWidth: '10ch',
              textAlign: 'start',
              fontVariantNumeric: 'tabular-nums',
              color: speed === undefined || speed === 0 ? 'var(--gray-a9)' : undefined,
            }}
          >
            {text}
          </span>
        </Link>
      </Button>
    </Tooltip>
  )
}

export function TransferSpeeds() {
  return (
    <Flex align="center" gap="4">
      <Speed direction="download" />
      <Speed direction="upload" />
    </Flex>
  )
}
