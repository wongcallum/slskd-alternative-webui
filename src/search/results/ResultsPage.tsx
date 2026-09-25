import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Box, Flex, Heading, IconButton, Link, Text } from '@radix-ui/themes'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'

import { describeError } from '../../lib/api'
import { formatDuration } from '../../lib/format'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { ActionButton, toolbarStyle } from '../../ui/controls'
import { Ago, Empty, ErrorCallout, Freshness, Loading, Polling } from '../../ui/status'
import {
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
import { useCreateSearch } from '../useCreateSearch'
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

  if (search === undefined) {
    if (known) {
      return (
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
    }
    return <Polling what="searches" error={data === undefined ? error : undefined} />
  }

  let content: ReactNode
  if (!saved) {
    content = <Running search={search} />
  } else if (entry?.results === undefined) {
    content =
      entry?.error === undefined ? (
        <Loading />
      ) : (
        <ErrorCallout onRetry={() => void loadResults(id)}>
          Can't load the results: {describeError(entry.error)}
        </ErrorCallout>
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
  const again = useCreateSearch()

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
          onClick={() => void again.create(search.text)}
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
    <Flex justify="center" p="6">
      <Text color="gray">{message}</Text>
    </Flex>
  )
}
