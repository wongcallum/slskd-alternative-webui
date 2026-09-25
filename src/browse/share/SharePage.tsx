import { Box, Button, Callout, Flex, Heading, Text, Tooltip } from '@radix-ui/themes'
import { type ReactNode, useEffect } from 'react'
import { describeError } from '../../lib/api'
import { formatBytes, plural } from '../../lib/format'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { ActionButton, Ago, DelayedSpinner, toolbarStyle } from '../../ui/controls'
import { browse, browses, failures, loadedShares, reloadShare, viewShare } from '../browse'
import { BrowseProgress, FailureLine } from '../BrowseStatus'
import type { BrowseSearch } from '../params'
import { UserBox } from '../UserBox'
import { ShareView } from './ShareView'

type Props = {
  search: BrowseSearch
  onSearchChange: (patch: Partial<BrowseSearch>) => void
}

export function SharePage({ search, onSearchChange }: Props) {
  const username = search.user
  useEffect(() => viewShare(username), [username])
  const loaded = useAtom(loadedShares).get(username)
  const running = useAtom(browses).get(username)
  const failure = useAtom(failures).get(username)
  const soulseekGate = useSoulseekGate()
  const gate = running === undefined ? soulseekGate : `Already browsing ${username}`
  const ready = loaded?.status === 'ready' ? loaded : undefined
  const top = ready?.share.top

  let content: ReactNode
  if (ready !== undefined) {
    content =
      ready.share.folderCount === 0 ? (
        <Box p="5">
          <Text color="gray">{username} shares nothing (or has blocked you).</Text>
        </Box>
      ) : (
        <ShareView share={ready.share} fetchedAt={ready.fetchedAt} search={search} onSearchChange={onSearchChange} />
      )
  } else if (loaded?.status === 'failed') {
    content = (
      <Box p="4">
        <Callout.Root color="red">
          <Callout.Text>Can't read the cached share: {describeError(loaded.error)}</Callout.Text>
        </Callout.Root>
        <Button mt="3" variant="soft" onClick={() => reloadShare(username)}>
          Try again
        </Button>
      </Box>
    )
  } else if (loaded?.status === 'missing' && running !== undefined) {
    content = (
      <Flex justify="center" p="6">
        <BrowseProgress username={username} running={running} />
      </Flex>
    )
  } else if (loaded?.status === 'missing') {
    content = (
      <Flex direction="column" align="start" gap="3" p="5">
        <Heading size="4">Not browsed yet</Heading>
        <Text color="gray">Browsing fetches {username}'s whole share from them.</Text>
        <ActionButton label={`Browse ${username}`} busy="Browsing" gate={gate} onClick={() => void browse(username)} />
      </Flex>
    )
  } else {
    content = (
      <Flex justify="center" p="6">
        <DelayedSpinner />
      </Flex>
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Flex align="center" gap="4" px="4" py="3" flexShrink="0" style={toolbarStyle}>
        <UserBox current={username} />
        {top !== undefined && (
          <Text size="2" color="gray">
            {plural(top.fileCount, 'file')} · {formatBytes(top.size)}
            {top.lockedCount > 0 && ` · ${top.lockedCount.toLocaleString()} locked`}
          </Text>
        )}
        <Flex ml="auto" align="center" gap="3" flexShrink="0">
          {ready?.notCached !== undefined && (
            <Tooltip content={ready.notCached}>
              <Text size="2" color="amber">
                Not cached
              </Text>
            </Tooltip>
          )}
          {ready !== undefined && (
            <Text size="2" color="gray">
              fetched <Ago time={ready.fetchedAt} />
            </Text>
          )}
          {ready !== undefined && (
            <ActionButton label="Re-browse" busy="Browsing" gate={gate} onClick={() => void browse(username)} />
          )}
        </Flex>
      </Flex>
      {ready !== undefined && running !== undefined ? (
        <Flex align="center" px="4" py="2" flexShrink="0" style={toolbarStyle}>
          <BrowseProgress username={username} running={running} />
        </Flex>
      ) : (
        failure !== undefined && (
          <Flex align="center" px="4" py="2" flexShrink="0" style={toolbarStyle}>
            <FailureLine username={username} failure={failure} />
          </Flex>
        )
      )}
      {content}
    </Flex>
  )
}
