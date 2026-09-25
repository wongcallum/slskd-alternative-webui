import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Box, Button, Callout, Flex, Heading, IconButton, Link, Text } from '@radix-ui/themes'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'
import { describeError } from '../../lib/api'
import { formatDuration } from '../../lib/format'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { ActionButton, Ago, DelayedSpinner, Freshness, toolbarStyle } from '../../ui/controls'
import {
  createSearch,
  deleteSearches,
  listActions,
  listGate,
  type Search,
  searches,
  searchPollInterval,
  stopSearches,
  useSearches,
} from '../searches'
import { describeCounts, SearchState } from '../SearchState'
import type { ResultsSearch } from './params'
import { entries, loadResults, openResults } from './results'
import { ResultsView } from './ResultsView'

type Props = {
  id: string
  search: ResultsSearch
  onSearchChange: (patch: Partial<ResultsSearch>) => void
}

export function ResultsPage({ id, search: params, onSearchChange }: Props) {
  const { data, error, live, known } = useSearches()
  const search = data?.byId.get(id)
  const entry = useAtom(entries).get(id)
  const saved = search?.endedAt !== undefined
  useEffect(() => {
    openResults(id)
  }, [id])
  useEffect(() => {
    if (saved) void loadResults(id)
  }, [id, saved])

  let content: ReactNode
  if (search === undefined) {
    if (known) {
      content = (
        <Box p="5">
          <Heading mb="2">No such search</Heading>
          <Text as="p" color="gray" mb="3">
            It may have been deleted.
          </Text>
          <Link asChild>
            <RouterLink to="/searches">Go to Search</RouterLink>
          </Link>
        </Box>
      )
    } else if (data === undefined && error !== undefined) {
      content = (
        <Box p="4">
          <Callout.Root color="red">
            <Callout.Text>Can't load searches: {describeError(error)}. Retrying.</Callout.Text>
          </Callout.Root>
        </Box>
      )
    } else {
      content = (
        <Flex justify="center" p="6">
          <DelayedSpinner />
        </Flex>
      )
    }
    return content
  }

  if (!saved) {
    content = <Running search={search} />
  } else if (entry?.results === undefined) {
    content =
      entry?.error === undefined ? (
        <Flex justify="center" p="6">
          <DelayedSpinner />
        </Flex>
      ) : (
        <Box p="4">
          <Callout.Root color="red">
            <Callout.Text>Can't load the results: {describeError(entry.error)}</Callout.Text>
          </Callout.Root>
          <Button mt="3" variant="soft" onClick={() => void loadResults(id)}>
            Try again
          </Button>
        </Box>
      )
  } else if (entry.results.all.length === 0) {
    content = (
      <Box p="5">
        <Text color="gray">No results.</Text>
      </Box>
    )
  } else {
    content = (
      <ResultsView
        searchId={id}
        results={entry.results}
        folders={entry.folders}
        params={params}
        onSearchChange={onSearchChange}
      />
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Header search={search} known={known} live={live} error={error} />
      {content}
    </Flex>
  )
}

function Header({ search, known, live, error }: { search: Search; known: boolean; live: boolean; error: unknown }) {
  const navigate = useNavigate()
  const soulseekGate = useSoulseekGate()
  const gate = listGate(known)
  const { running } = useAtom(listActions)
  const [again, setAgain] = useState<{ busy: boolean; error?: string }>({ busy: false })

  async function searchAgain() {
    setAgain({ busy: true })
    try {
      const id = await createSearch(search.text)
      void navigate({ to: '/searches/$id', params: { id } })
      setAgain({ busy: false })
    } catch (thrown) {
      setAgain({ busy: false, error: describeError(thrown) })
    }
  }

  return (
    <Flex align="center" gap="3" px="4" py="3" flexShrink="0" style={toolbarStyle}>
      <IconButton asChild variant="ghost" color="gray" aria-label="Back to searches">
        <RouterLink to="/searches">
          <ArrowLeftIcon />
        </RouterLink>
      </IconButton>
      <Heading size="4" truncate title={search.text}>
        {search.text}
      </Heading>
      <Flex align="center" gap="3" flexShrink="0">
        <SearchState search={search} />
        <Text size="2" color="gray">
          {describeCounts(search)}
        </Text>
        <Text size="2" color="gray">
          started <Ago time={search.startedAt} />
          {search.endedAt !== undefined &&
            ` · took ${formatDuration(Math.max(0, (search.endedAt - search.startedAt) / 1000))}`}
        </Text>
      </Flex>
      <Flex ml="auto" align="center" gap="2" flexShrink="0">
        {again.error !== undefined && (
          <Text size="2" color="red">
            {again.error}
          </Text>
        )}
        {!search.isComplete && (
          <ActionButton
            label="Stop"
            busy="Stopping"
            progress={running.stop}
            gate={gate}
            onClick={() => stopSearches([search])}
          />
        )}
        <ActionButton
          label="Search again"
          busy="Searching"
          loading={again.busy}
          gate={soulseekGate}
          onClick={() => void searchAgain()}
        />
        <ActionButton
          label="Delete"
          busy="Deleting"
          color="red"
          gate={gate}
          onClick={() => {
            void deleteSearches([search])
            void navigate({ to: '/searches', replace: true })
          }}
        />
        <Box ml="2">
          <Freshness resource={searches} interval={searchPollInterval} error={error} live={live} />
        </Box>
      </Flex>
    </Flex>
  )
}

function Running({ search }: { search: Search }) {
  let message: string
  if (search.state === 'Queued') message = 'Waiting for a search slot: slskd runs 2 searches at once.'
  else if (search.isComplete) message = 'Saving the results…'
  else message = 'Results appear when the search ends. Stop it to see them now.'
  return (
    <Flex direction="column" align="center" gap="2" p="6">
      {search.state === 'InProgress' && (
        <Text size="5" weight="medium">
          {describeCounts(search)}
        </Text>
      )}
      <Text color="gray">{message}</Text>
    </Flex>
  )
}
