import { MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { Box, Button, Flex, Spinner, TextField } from '@radix-ui/themes'
import { type SubmitEvent, useState } from 'react'

import { useTouch } from '../lib/media'
import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps, mainField, toList, Toolbar } from '../ui/controls'
import { ActionNote } from '../ui/status'
import { useCreateSearch } from './useCreateSearch'

export function NewSearch() {
  const gate = useSoulseekGate()
  const touch = useTouch()
  const [text, setText] = useState('')
  const { busy, error, create } = useCreateSearch()

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const searchText = text.trim()
    if (gate !== undefined || busy || searchText === '') return
    void create(searchText)
  }

  return (
    <Toolbar>
      <Box asChild flexGrow="1" maxWidth="600px">
        <form onSubmit={submit}>
          <Flex gap="2" align="center">
            <TextField.Root
              size="2"
              placeholder="Search Soulseek"
              autoFocus={!touch}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={toList('searches')}
              {...mainField(true)}
              style={{ flexGrow: 1 }}
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
            <Button size="2" type="submit" {...disabledProps(gate !== undefined || busy)}>
              Search
            </Button>
          </Flex>
        </form>
      </Box>
      <ActionNote error={error} gate={gate} size="2" />
    </Toolbar>
  )
}
