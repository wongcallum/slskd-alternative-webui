import { Cross2Icon } from '@radix-ui/react-icons'
import { Box, Flex, IconButton, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'

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

export function DetailsPane({
  header,
  onClose,
  children,
}: {
  header: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Flex
      direction="column"
      gap="2"
      flexShrink="0"
      maxHeight="45%"
      px="4"
      py="3"
      style={{ boxShadow: 'inset 0 1px 0 0 var(--gray-a5)' }}
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
