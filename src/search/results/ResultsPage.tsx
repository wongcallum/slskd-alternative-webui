import { Box, Flex, Heading, Text } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'

import { formatAge } from '../../lib/format'
import type { SearchProps } from '../../lib/params'
import { useAtom } from '../../lib/store'
import { useRun } from '../../lib/useRun'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { ActionButton, toolbarStyle } from '../../ui/controls'
import { BackLink } from '../../ui/nav'
import { Ago, Empty, Fetching, Freshness, Missing, Polling } from '../../ui/status'
import {
  deleteSearches,
  listGate,
  type Search,
  searches,
  searchPollInterval,
  stopSearch,
  useSearches,
} from '../searches'
import { describeCounts, SearchState } from '../SearchState'
import { useCreateSearch } from '../useCreateSearch'
import type { ResultsSearch } from './params'
import { entries, loadResults, openResults } from './results'
import { ResultsView } from './ResultsView'

type Props = SearchProps<ResultsSearch> & {
  id: string
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

  if (search === undefined) {
    if (known) return <Missing title="No such search">It may have been deleted.</Missing>
    return <Polling what="searches" error={data === undefined ? error : undefined} />
  }

  let content: ReactNode
  if (!saved) {
    content = <Running search={search} />
  } else if (entry?.results === undefined) {
    content = (
      <Fetching error={entry?.error} onRetry={() => void loadResults(id)}>
        Can't load the results
      </Fetching>
    )
  } else if (entry.results.all.length === 0) {
    content = <Empty>No results.</Empty>
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
      <Header search={search} known={known} live={live} />
      {content}
    </Flex>
  )
}

function Header({ search, known, live }: { search: Search; known: boolean; live: boolean }) {
  const navigate = useNavigate()
  const soulseekGate = useSoulseekGate()
  const gate = listGate(known)
  const stop = useRun()
  const again = useCreateSearch()
  const failure = stop.error === undefined ? again.error : `Couldn't stop: ${stop.error}`

  // Below md the title, the summary and the actions each take a line.
  return (
    <Flex
      align="center"
      gap="3"
      wrap={{ initial: 'wrap', md: 'nowrap' }}
      px="4"
      py="3"
      flexShrink="0"
      style={toolbarStyle}
    >
      <Flex align="center" gap="3" minWidth="0" flexBasis={{ initial: '100%', md: 'auto' }}>
        <BackLink to="/searches" label="Back to searches" />
        <Heading size="4" truncate title={search.text}>
          {search.text}
        </Heading>
      </Flex>
      <Flex align="center" gap="3" flexShrink={{ initial: '1', md: '0' }} wrap="wrap">
        <SearchState search={search} />
        <Text size="2" color="gray">
          {describeCounts(search)}
        </Text>
        <Text size="2" color="gray">
          Started <Ago time={search.startedAt} />
          {search.endedAt !== undefined && `, took ${formatAge(search.endedAt - search.startedAt)}`}
        </Text>
      </Flex>
      <Flex ml="auto" align="center" gap="2" flexShrink="0">
        {failure !== undefined && (
          <Text size="2" color="red">
            {failure}
          </Text>
        )}
        {!search.isComplete && (
          <ActionButton
            label="Stop"
            loading={stop.running}
            gate={gate}
            onClick={() => stop.run(() => stopSearch(search))}
          />
        )}
        <ActionButton
          label="Search again"
          loading={again.busy}
          gate={soulseekGate}
          onClick={() => void again.create(search.text)}
        />
        <ActionButton
          label="Delete"
          color="red"
          gate={gate}
          onClick={() => {
            void deleteSearches([search])
            void navigate({ to: '/searches', replace: true })
          }}
        />
        <Box ml="2">
          <Freshness resource={searches} interval={searchPollInterval} live={live} />
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
    <Flex justify="center" p="6">
      <Text color="gray">{message}</Text>
    </Flex>
  )
}
