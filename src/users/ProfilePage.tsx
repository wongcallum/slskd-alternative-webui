import { Badge, Box, Button, Dialog, Flex, Grid, Heading, Link, Spinner, Text, Tooltip } from '@radix-ui/themes'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'

import { loadShareList, shareList } from '../browse/browse'
import { useBrowseUser } from '../browse/useBrowseUser'
import { describeError } from '../lib/api'
import { formatBytes, plural } from '../lib/format'
import { useAtom, useResource } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { ActionButton, toolbarStyle } from '../ui/controls'
import { LinkedText } from '../ui/LinkedText'
import { Ago, Busy, Loading } from '../ui/status'
import { LookUpBox } from './LookUpBox'
import { LookupErrorLine, PresenceLabel } from './LookupStatus'
import {
  type DirectionHistory,
  loadPicture,
  loadUserList,
  lookedUpAt,
  lookUp,
  type LookupErrors,
  lookupErrors,
  lookups,
  pictures,
  transferHistory,
  type UserRecord,
  userList,
} from './users'

export function ProfilePage({ username }: { username: string }) {
  useEffect(() => {
    void loadUserList()
  }, [])
  const list = useAtom(userList)
  const record = list.records.get(username)
  const startedAt = useAtom(lookups).get(username)
  const errors = useAtom(lookupErrors).get(username)
  const gate = useSoulseekGate()
  const running = startedAt !== undefined

  let content: ReactNode
  if (record !== undefined) content = <Profile record={record} errors={errors} />
  else if (!list.loaded) content = <Loading />
  else if (running) content = <Busy>Looking up {username}…</Busy>
  else if (list.error !== undefined && errors === undefined) {
    content = <Text color="red">Can't read the stored profiles: {describeError(list.error)}</Text>
  } else {
    content = (
      <Flex direction="column" align="start" gap="3">
        <Heading size="4">{errors === undefined ? 'Not looked up yet' : 'Nothing found'}</Heading>
        {errors !== undefined && <LookupErrorLine username={username} errors={errors} />}
        <Text color="gray">Looking up asks the server for {username}'s status, and them for their profile.</Text>
        <ActionButton label={`Look up ${username}`} busy="" gate={gate} onClick={() => void lookUp(username)} />
      </Flex>
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Flex align="center" gap="4" px="4" py="3" flexShrink="0" style={toolbarStyle}>
        <LookUpBox current={username} />
        {record !== undefined && (
          <Flex ml="auto" align="center" gap="3" flexShrink="0">
            <Text size="2" color="gray">
              updated <Ago time={lookedUpAt(record)} />
            </Text>
            <ActionButton
              label="Look up again"
              busy=""
              loading={running}
              gate={gate}
              onClick={() => void lookUp(username)}
            />
          </Flex>
        )}
      </Flex>
      <Box flexGrow="1" overflow="auto">
        <Flex direction="column" gap="4" p="4" maxWidth="900px">
          {content}
          <TransferHistory username={username} />
        </Flex>
      </Box>
    </Flex>
  )
}

function Profile({ record, errors }: { record: UserRecord; errors?: LookupErrors }) {
  const { username, status, info } = record
  const navigate = useNavigate()
  const browseUser = useBrowseUser()
  const picture = useAtom(pictures).get(username)
  const newest = lookedUpAt(record)
  useEffect(() => {
    if (info?.hasPicture) void loadPicture(username)
  }, [username, info])

  return (
    <>
      <Flex gap="4" align="start">
        {info?.hasPicture && typeof picture === 'string' && <Picture username={username} picture={picture} />}
        <Flex direction="column" gap="2" minWidth="0">
          <Heading size="5" style={{ overflowWrap: 'anywhere' }}>
            {username}
          </Heading>
          {status !== undefined && (
            <Flex align="center" gap="3" wrap="wrap">
              <PresenceLabel presence={status.presence} />
              {status.privileged && <Badge color="amber">Privileged</Badge>}
              {status.address !== undefined && (
                <Text size="2" color="gray">
                  {status.address}
                </Text>
              )}
              {status.fetchedAt < newest && <AsOf time={status.fetchedAt} />}
            </Flex>
          )}
          {info !== undefined && (
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" color={info.freeSlot ? 'green' : 'gray'}>
                {info.freeSlot ? 'Free upload slot' : 'No free upload slot'}
              </Text>
              <Text size="2" color="gray">
                {plural(info.slots, 'upload slot')}, {info.queue.toLocaleString()} queued
              </Text>
              {info.fetchedAt < newest && <AsOf time={info.fetchedAt} />}
            </Flex>
          )}
          {errors !== undefined && <LookupErrorLine username={username} errors={errors} />}
          <Flex align="center" gap="3" mt="1" wrap="wrap">
            <Button size="1" variant="soft" onClick={() => void navigate({ to: '/chat', search: { user: username } })}>
              Message
            </Button>
            <Button size="1" variant="soft" onClick={() => browseUser(username)}>
              Browse
            </Button>
            <CachedShare username={username} />
          </Flex>
        </Flex>
      </Flex>
      {info !== undefined && (
        <Text as="p" size="2" color={info.description === '' ? 'gray' : undefined} className="user-description">
          {info.description === '' ? 'No description.' : <LinkedText>{info.description}</LinkedText>}
        </Text>
      )}
    </>
  )
}

function AsOf({ time }: { time: number }) {
  return (
    <Text size="1" color="gray">
      as of <Ago time={time} />
    </Text>
  )
}

function Picture({ username, picture }: { username: string; picture: string }) {
  const src = `data:image;base64,${picture}`
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <button type="button" className="user-picture" aria-label={`Show ${username}'s picture full size`}>
          <img src={src} alt="" />
        </button>
      </Dialog.Trigger>
      <Dialog.Content width="fit-content" maxWidth="90vw" aria-describedby={undefined}>
        <Dialog.Title size="3">{username}</Dialog.Title>
        <img src={src} alt={username} style={{ display: 'block', maxWidth: '100%', maxHeight: '75vh' }} />
      </Dialog.Content>
    </Dialog.Root>
  )
}

function CachedShare({ username }: { username: string }) {
  useEffect(() => {
    void loadShareList()
  }, [])
  const share = useAtom(shareList).records.get(username)
  if (share === undefined) return null
  return (
    <Text size="2" color="gray">
      Share browsed <Ago time={share.fetchedAt} />: {plural(share.files, 'file')}, {formatBytes(share.size)}
    </Text>
  )
}

function TransferHistory({ username }: { username: string }) {
  const { data, error } = useResource(transferHistory.get(username))
  let content: ReactNode
  if (data === undefined) {
    content =
      error === undefined ? (
        <Spinner />
      ) : (
        <Text size="2" color="red">
          Can't load the history: {describeError(error)}
        </Text>
      )
  } else if (data.download.total === 0 && data.upload.total === 0) {
    content = (
      <Text size="2" color="gray">
        No finished transfers with {username}.
      </Text>
    )
  } else {
    content = (
      <Grid columns="max-content 1fr" gapX="4" gapY="1" align="center">
        <Direction label="Downloads" to="/downloads" username={username} history={data.download} />
        <Direction label="Uploads" to="/uploads" username={username} history={data.upload} />
      </Grid>
    )
  }
  return (
    <Flex direction="column" gap="2">
      <Heading size="3">Transfers</Heading>
      {content}
      {data !== undefined && (
        <Text size="1" color="gray">
          All time, including removed transfers. Each retry counts separately.
        </Text>
      )}
    </Flex>
  )
}

function Direction({
  label,
  to,
  username,
  history,
}: {
  label: string
  to: '/downloads' | '/uploads'
  username: string
  history: DirectionHistory
}) {
  const reasons = history.reasons.map((reason) => `${reason.count.toLocaleString()} × ${reason.exception}`)
  return (
    <>
      <Text size="2" weight="medium">
        {label}
      </Text>
      <Flex align="center" gap="3" wrap="wrap">
        {history.total === 0 ? (
          <Text size="2" color="gray">
            None
          </Text>
        ) : (
          <>
            <Text size="2">
              {history.succeeded.toLocaleString()} succeeded ({formatBytes(history.bytes)})
            </Text>
            {history.failed > 0 && (
              <Tooltip content={reasons.join('\n')} style={{ whiteSpace: 'pre-line' }}>
                <Text size="2" color="red">
                  {history.failed.toLocaleString()} failed
                </Text>
              </Tooltip>
            )}
            {history.cancelled > 0 && (
              <Text size="2" color="gray">
                {history.cancelled.toLocaleString()} cancelled
              </Text>
            )}
          </>
        )}
        <Link asChild size="2">
          <RouterLink to={to} search={{ q: username }}>
            Show in {label}
          </RouterLink>
        </Link>
      </Flex>
    </>
  )
}
