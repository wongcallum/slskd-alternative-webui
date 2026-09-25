import { LockClosedIcon, PlusIcon, StarIcon } from '@radix-ui/react-icons'
import { Badge, Button, Dialog, Flex, Spinner, Text, Tooltip } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useDeferredValue, useMemo, useState } from 'react'

import { api, describeError } from '../lib/api'
import { byName } from '../lib/text'
import { FilterField, GateTip } from '../ui/controls'
import { ErrorCallout, Loading } from '../ui/status'
import { ColumnHeader, GridRow, HeaderRow, VirtualTable } from '../ui/table'
import { joinRoom, useJoinedRooms } from './rooms'

type RawAvailableRoom = { name: string; userCount: number; isPrivate: boolean; isOwned: boolean; isModerated: boolean }

type Listing =
  | { status: 'loading' }
  | { status: 'failed'; error: unknown }
  | { status: 'ready'; rooms: RawAvailableRoom[] }

type Sort = { id: 'name' | 'users'; desc: boolean }

const template = 'minmax(0, 1fr) 90px 64px'

const roomKey = (room: RawAvailableRoom) => room.name

// Opening the dialog is the gesture that asks the server for its room list.
export function JoinRoomDialog({ gate, children }: { gate?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [listing, setListing] = useState<Listing>({ status: 'loading' })

  async function load() {
    setListing({ status: 'loading' })
    try {
      setListing({ status: 'ready', rooms: await api.get('rooms/available').json<RawAvailableRoom[]>() })
    } catch (error) {
      setListing({ status: 'failed', error })
    }
  }

  function onOpenChange(next: boolean) {
    if (next && gate !== undefined) return
    setOpen(next)
    if (next) void load()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <GateTip gate={gate} label="Join a room">
        <Dialog.Trigger>{children}</Dialog.Trigger>
      </GateTip>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Join a room</Dialog.Title>
        {open && <RoomPicker listing={listing} onRetry={() => void load()} onJoined={() => setOpen(false)} />}
      </Dialog.Content>
    </Dialog.Root>
  )
}

function RoomPicker({ listing, onRetry, onJoined }: { listing: Listing; onRetry: () => void; onJoined: () => void }) {
  const navigate = useNavigate()
  const { rooms: joined } = useJoinedRooms()
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>({ id: 'users', desc: true })
  const [joining, setJoining] = useState<string>()
  const [error, setError] = useState<string>()
  const needle = useDeferredValue(filter).toLowerCase()
  const typed = filter.trim()

  const available = listing.status === 'ready' ? listing.rooms : undefined
  const shown = useMemo(() => {
    if (available === undefined) return []
    const matching = needle === '' ? available : available.filter((room) => room.name.toLowerCase().includes(needle))
    const direction = sort.desc ? -1 : 1
    return matching.toSorted((a, b) =>
      sort.id === 'name' ? direction * byName(a, b) : direction * (a.userCount - b.userCount) || byName(a, b),
    )
  }, [available, needle, sort])

  async function join(name: string) {
    if (joining !== undefined) return
    if (!joined.includes(name)) {
      setJoining(name)
      setError(undefined)
      try {
        await joinRoom(name)
      } catch (thrown) {
        setError(`Can't join ${name}: ${describeError(thrown)}`)
        setJoining(undefined)
        return
      }
    }
    onJoined()
    void navigate({ to: '/rooms', search: { room: name } })
  }

  const sortable = (id: Sort['id']) => ({
    getIsSorted: () => (sort.id === id ? (sort.desc ? 'desc' : 'asc') : false),
    getToggleSortingHandler: () => () =>
      setSort((current) => (current.id === id ? { id, desc: !current.desc } : { id, desc: id === 'users' })),
  })

  let list: ReactNode
  if (listing.status === 'loading') list = <Loading />
  else if (listing.status === 'failed') {
    list = <ErrorCallout onRetry={onRetry}>Can't load the room list: {describeError(listing.error)}</ErrorCallout>
  } else {
    const header = (
      <HeaderRow template={template}>
        <ColumnHeader label="Room" column={sortable('name')} />
        <ColumnHeader label="Users" end column={sortable('users')} />
        <div />
      </HeaderRow>
    )
    list = (
      <VirtualTable
        minWidth={0}
        header={header}
        items={shown}
        itemKey={roomKey}
        renderItem={(room) => (
          <RoomRow
            room={room}
            joined={joined.includes(room.name)}
            joining={joining === room.name}
            onJoin={() => void join(room.name)}
          />
        )}
      />
    )
  }

  const listed = available?.some((room) => room.name === typed) === true

  return (
    <Flex direction="column" gap="3">
      <FilterField
        placeholder="Filter, or type a room to join"
        value={filter}
        onChange={setFilter}
        style={{ width: '100%' }}
      />
      {typed !== '' && (
        <Flex align="center" gap="3">
          <Button variant="soft" loading={joining === typed} onClick={() => void join(typed)}>
            <PlusIcon />
            Join “{typed}”
          </Button>
          {!listed && (
            <Text size="1" color="gray">
              Creates it if it doesn't exist
            </Text>
          )}
        </Flex>
      )}
      <Flex direction="column" height="clamp(160px, 50dvh, 400px)">
        {list}
      </Flex>
      <Flex align="center" justify="between" gap="3">
        <Text size="2" color="red">
          {error}
        </Text>
        <Dialog.Close>
          <Button variant="soft" color="gray">
            Close
          </Button>
        </Dialog.Close>
      </Flex>
    </Flex>
  )
}

type RoomRowProps = { room: RawAvailableRoom; joined: boolean; joining: boolean; onJoin: () => void }

function RoomRow({ room, joined, joining, onJoin }: RoomRowProps) {
  return (
    <GridRow template={template} style={{ cursor: 'pointer' }} onClick={onJoin}>
      <Flex className="table-cell" align="center" gap="2" title={room.name}>
        <Text size="2" truncate>
          {room.name}
        </Text>
        {room.isPrivate && (
          <Tooltip content="Private">
            <LockClosedIcon style={{ flexShrink: 0 }} />
          </Tooltip>
        )}
        {room.isOwned && (
          <Tooltip content="Yours">
            <StarIcon style={{ flexShrink: 0 }} />
          </Tooltip>
        )}
        {room.isModerated && (
          <Badge size="1" color="gray">
            Operator
          </Badge>
        )}
      </Flex>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {room.userCount.toLocaleString()}
        </Text>
      </div>
      <Flex className="table-cell" justify="end" align="center">
        {joining ? (
          <Spinner />
        ) : joined ? (
          <Text size="1" color="gray">
            Joined
          </Text>
        ) : null}
      </Flex>
    </GridRow>
  )
}
