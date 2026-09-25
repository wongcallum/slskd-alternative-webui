import { ExclamationTriangleIcon } from '@radix-ui/react-icons'
import { Callout, Flex, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'

export function PendingCallout({ error, children }: { error?: string; children: ReactNode }) {
  return (
    // Callout is a grid that sizes its columns to their content, so a flex row lets the action sit at the far end.
    <Callout.Root color="amber" size="1" style={{ display: 'flex' }}>
      <Callout.Icon>
        <ExclamationTriangleIcon />
      </Callout.Icon>
      <Flex direction="column" gap="1" flexGrow="1">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          {children}
        </Flex>
        {error !== undefined && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
      </Flex>
    </Callout.Root>
  )
}
