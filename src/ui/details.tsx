import { Cross2Icon } from '@radix-ui/react-icons'
import { Box, Flex, IconButton, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'

import { useFrom, useMedia } from '../lib/media'

export function Preformatted({ children }: { children: ReactNode }) {
  return (
    <Text asChild size="2">
      <pre
        style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--code-font-family)' }}
      >
        {children}
      </pre>
    </Text>
  )
}

// Below the list, or below sm and on short screens over it, so the list keeps its place underneath. The parent has
// to be positioned.
export function DetailsPane({
  header,
  onClose,
  children,
}: {
  header: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const sm = useFrom('sm')
  const short = useMedia('(max-height: 599px)')
  const cover = !sm || short
  return (
    <Flex
      direction="column"
      gap="2"
      flexShrink="0"
      maxHeight={cover ? undefined : '45%'}
      position={cover ? 'absolute' : undefined}
      inset={cover ? '0' : undefined}
      px="4"
      py="3"
      style={
        cover
          ? { zIndex: 2, backgroundColor: 'var(--color-background)' }
          : { boxShadow: 'inset 0 1px 0 0 var(--gray-a5)' }
      }
    >
      <Flex align="center" gap="3" wrap="wrap">
        {header}
        <Flex ml="auto">
          <IconButton size="1" variant="ghost" color="gray" aria-label="Close" onClick={onClose}>
            <Cross2Icon />
          </IconButton>
        </Flex>
      </Flex>
      <Box minHeight="0" overflow="auto">
        {children}
      </Box>
    </Flex>
  )
}
