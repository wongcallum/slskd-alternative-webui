import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import { type ReactNode, useEffect, useMemo } from 'react'

import { describeError } from '../../lib/api'
import { formatBytes, plural } from '../../lib/format'
import { useFrom } from '../../lib/media'
import type { SearchProps } from '../../lib/params'
import { useAtom } from '../../lib/store'
import { useSoulseekGate } from '../../soulseek/soulseek'
import { ActionButton, Tip, toolbarStyle } from '../../ui/controls'
import { Ago, Empty, ErrorCallout, Loading } from '../../ui/status'
import { TreeView } from '../../ui/tree/TreeView'
import { UserPage } from '../../ui/UserList'
import { UserMenu } from '../../users/UserMenu'
import { browse, browses, failures, loadedShares, reloadShare, viewShare } from '../browse'
import { BrowseProgress, FailureLine } from '../BrowseStatus'
import type { BrowseSearch } from '../params'
import { UserBox } from '../UserBox'
import { shareConfig } from './shareConfig'

type Props = SearchProps<BrowseSearch>

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
  const config = useMemo(() => shareConfig(username), [username])
  const sm = useFrom('sm')

  let content: ReactNode
  if (ready !== undefined) {
    content =
      ready.share.folderCount === 0 ? (
        <Empty>{username} shares nothing (or has blocked you).</Empty>
      ) : (
        <TreeView
          tree={ready.share}
          fetchedAt={ready.fetchedAt}
          search={search}
          onSearchChange={onSearchChange}
          config={config}
        />
      )
  } else if (loaded?.status === 'failed') {
    content = (
      <ErrorCallout onRetry={() => reloadShare(username)}>
        Can't read the cached share: {describeError(loaded.error)}
      </ErrorCallout>
    )
  } else if (loaded?.status === 'missing' && running !== undefined) {
    content = (
      <Flex justify="center" p="6">
        <BrowseProgress running={running} />
      </Flex>
    )
  } else if (loaded?.status === 'missing') {
    content = (
      <Flex direction="column" align="start" gap="3" p="5">
        <Heading size="4">Not browsed yet</Heading>
        <Text color="gray">Browsing fetches {username}'s whole share.</Text>
        <ActionButton label={`Browse ${username}`} gate={gate} onClick={() => void browse(username)} />
      </Flex>
    )
  } else content = <Loading />

  let line: ReactNode
  if (ready !== undefined && running !== undefined) line = <BrowseProgress running={running} />
  else if (failure !== undefined) line = <FailureLine username={username} failure={failure} />

  return (
    <UserPage
      toolbar={
        <>
          <UserBox current={username} />
          <UserMenu username={username} here="browse">
            <IconButton size="2" variant="ghost" color="gray" aria-label={`More for ${username}`}>
              <DotsHorizontalIcon />
            </IconButton>
          </UserMenu>
          {/* Below sm the summary, its age and Browse again share the line under the box. */}
          <Flex align="center" gap="3" minWidth="0" flexGrow="1" flexBasis={{ initial: '100%', sm: '0' }}>
            {top !== undefined && (
              <Text size="2" color="gray" truncate>
                {plural(top.fileCount, 'file')}
                {top.lockedCount > 0 && ` (${top.lockedCount.toLocaleString()} locked)`}, {formatBytes(top.size)}
                {!sm && ready !== undefined && (
                  <>
                    , browsed <Ago time={ready.fetchedAt} />
                  </>
                )}
              </Text>
            )}
            <Flex ml="auto" align="center" gap="3" flexShrink="0">
              {ready?.notCached !== undefined && (
                <Tip content={ready.notCached}>
                  <Text size="2" color="amber">
                    Not cached
                  </Text>
                </Tip>
              )}
              {sm && ready !== undefined && (
                <Text size="2" color="gray">
                  Browsed <Ago time={ready.fetchedAt} />
                </Text>
              )}
              {ready !== undefined && (
                <ActionButton label="Browse again" gate={gate} onClick={() => void browse(username)} />
              )}
            </Flex>
          </Flex>
        </>
      }
    >
      {line !== undefined && (
        <Flex align="center" px="4" py="2" flexShrink="0" style={toolbarStyle}>
          {line}
        </Flex>
      )}
      {content}
    </UserPage>
  )
}
