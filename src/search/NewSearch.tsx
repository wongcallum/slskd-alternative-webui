import { MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { Box, Button, Flex, Spinner, Text, TextField } from '@radix-ui/themes'
import { type SubmitEvent, useState } from 'react'
import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps } from '../ui/controls'
import { useCreateSearch } from './useCreateSearch'

export function NewSearch() {
  const gate = useSoulseekGate()
  const [text, setText] = useState('')
  const { busy, error, create } = useCreateSearch()

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const searchText = text.trim()
    if (gate !== undefined || busy || searchText === '') return
    void create(searchText)
  }

  return (
    <Box px="4" pt="4" pb="3" flexShrink="0">
      <form onSubmit={submit}>
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
          <Button size="3" type="submit" {...disabledProps(gate !== undefined || busy)}>
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
