import { MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { Box, Button, Flex, Spinner, Text, TextField } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type SubmitEvent, useEffect, useRef, useState } from 'react'
import { describeError } from '../lib/api'
import { useSoulseekGate } from '../soulseek/soulseek'
import { createSearch } from './searches'

export function NewSearch() {
  const navigate = useNavigate()
  const gate = useSoulseekGate()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const searchText = text.trim()
    if (gate !== undefined || busy || searchText === '') return
    setBusy(true)
    setError(undefined)
    try {
      const id = await createSearch(searchText)
      if (mounted.current) void navigate({ to: '/searches/$id', params: { id } })
    } catch (thrown) {
      if (!mounted.current) return
      setError(describeError(thrown))
      setBusy(false)
    }
  }

  return (
    <Box px="4" pt="4" pb="3" flexShrink="0">
      <form onSubmit={(event) => void submit(event)}>
        <Flex gap="2" align="center">
          <TextField.Root
            size="3"
            placeholder="Search Soulseek"
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            style={{ width: 520 }}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon />
            </TextField.Slot>
            {busy && (
              <TextField.Slot>
                <Spinner />
              </TextField.Slot>
            )}
          </TextField.Root>
          <Button
            size="3"
            type="submit"
            aria-disabled={gate !== undefined || busy || undefined}
            data-disabled={gate !== undefined || busy || undefined}
          >
            Search
          </Button>
        </Flex>
      </form>
      {(error ?? gate) !== undefined && (
        <Text as="p" size="2" mt="2" color={error === undefined ? 'gray' : 'red'}>
          {error ?? gate}
        </Text>
      )}
    </Box>
  )
}
