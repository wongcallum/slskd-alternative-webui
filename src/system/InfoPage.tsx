import { ExclamationTriangleIcon } from '@radix-ui/react-icons'
import { Box, Button, Callout, Card, Flex, Grid, Heading, Link, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'

import { browses } from '../browse/browse'
import { api, describeError } from '../lib/api'
import { formatAge, formatBytes, formatSpeed, plural } from '../lib/format'
import { useAtom, useClock, useResource } from '../lib/store'
import { useRun } from '../lib/useRun'
import { useSession } from '../session/session'
import { reconnect } from '../soulseek/soulseek'
import { ActionButton, ConfirmButton, type Detail, DetailList } from '../ui/controls'
import { Polling } from '../ui/status'
import { type Application, application, applicationPollInterval, releaseNotes, useApplication } from './application'
import { lifecycle, restart, restartPatience, shutDown } from './lifecycle'
import { processInfo } from './process'
import { SystemPage } from './SystemPage'

export function InfoPage() {
  const { data, error, live, known } = useApplication()
  return (
    <SystemPage
      resource={application}
      interval={applicationPollInterval}
      loaded={data !== undefined}
      error={error}
      live={live}
    >
      <Box flexGrow="1" minHeight="0" overflow="auto">
        {data === undefined ? (
          <Polling what="slskd's state" error={error} />
        ) : (
          <Flex direction="column" gap="4" p="4" maxWidth="1200px">
            <PendingCallouts data={data} known={known} />
            <Grid columns={{ initial: '1', md: '2' }} gap="4" align="start">
              <SlskdCard data={data} known={known} />
              <AccountCard data={data} />
              <SearchesCard data={data} />
              <NetworkCard data={data} />
            </Grid>
          </Flex>
        )}
      </Box>
    </SystemPage>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Heading as="h2" size="3">
          {title}
        </Heading>
        {children}
      </Flex>
    </Card>
  )
}

const outOfDate = "slskd's state is out of date"

function useLifecycleGate(known: boolean) {
  const { phase } = useAtom(lifecycle)
  if (phase === 'restarting') return 'slskd is restarting'
  if (phase === 'shutDown') return 'slskd is shut down'
  return known ? undefined : outOfDate
}

function RestartButton({ known, color }: { known: boolean; color?: 'amber' }) {
  const gate = useLifecycleGate(known)
  const browsing = useAtom(browses).size > 0
  const authenticated = useSession().status === 'authenticated'
  return (
    <ConfirmButton
      label="Restart"
      busy="Restarting"
      color={color}
      gate={gate ?? (browsing ? 'Wait for the browse to finish' : undefined)}
      title="Restart slskd?"
      description={[
        'Transfers stop, and unfinished downloads are enqueued again once slskd logs in, but into its default folders.',
        ...(authenticated ? ['Everyone is logged out.'] : []),
        'If slskd is still answering a request, such as a browse, the restart fails and slskd has to be started by hand.',
      ].join(' ')}
      action="Restart"
      onConfirm={() => void restart()}
    />
  )
}

function SlskdCard({ data, known }: { data: Application; known: boolean }) {
  const { data: process, error: processError } = useResource(processInfo)
  const gate = useLifecycleGate(known)
  const check = useRun()

  let latest: ReactNode = 'Not checked'
  if (data.updateAvailable && data.latest !== undefined) {
    latest = (
      <span>
        {data.latest} is available ·{' '}
        <Link href={releaseNotes(data.latest)} target="_blank" rel="noreferrer">
          Release notes
        </Link>
      </span>
    )
  } else if (data.latest !== undefined && data.build === undefined) latest = 'Up to date'

  const rows: Detail[] = [
    ['Version', data.build === undefined ? data.version : `${data.version} (${data.build} build)`],
    ['Latest', latest],
  ]
  if (process?.startedAt !== undefined) rows.push(['Uptime', <Uptime key="uptime" startedAt={process.startedAt} />])
  if (process?.runtime !== undefined) {
    rows.push(['Runtime', [process.runtime, process.architecture].filter(Boolean).join(' · ')])
  }
  if (process?.os !== undefined) rows.push(['OS', process.os])
  if (process?.memory !== undefined) rows.push(['Memory', formatBytes(process.memory)])
  if (process === undefined && processError !== undefined) {
    rows.push(['Uptime', `Can't load: ${describeError(processError)}. Retrying.`])
  }

  const checkGate = data.build === undefined ? gate : `${capitalise(data.build)} builds don't check for updates`

  return (
    <Section title="slskd">
      <DetailList rows={rows} />
      <Flex gap="2" wrap="wrap">
        <ActionButton
          label="Check for updates"
          busy="Checking"
          loading={check.running}
          gate={checkGate}
          onClick={() => check.run(() => api.get('application/version/latest', { searchParams: { forceCheck: true } }))}
        />
        <RestartButton known={known} />
        <ConfirmButton
          label="Shut down"
          busy="Shutting down"
          color="red"
          gate={gate}
          title="Shut down slskd?"
          description="Transfers stop, and slskd has to be started again by hand."
          action="Shut down"
          onConfirm={() => void shutDown()}
        />
      </Flex>
      {check.error !== undefined && (
        <Text size="2" color="red">
          Couldn't check for updates: {check.error}
        </Text>
      )}
      <LifecycleLine />
    </Section>
  )
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function Uptime({ startedAt }: { startedAt: number }) {
  return useClock((now) => formatAge(now - startedAt))
}

function LifecycleLine() {
  const state = useAtom(lifecycle)
  const overdue = useClock((now) => state.phase === 'restarting' && now - state.since > restartPatience)
  if (state.phase === 'restarting') {
    return (
      <Text size="2" color={overdue ? 'amber' : 'gray'}>
        {overdue ? 'Still waiting for slskd. If the restart failed, slskd has to be started by hand.' : 'Restarting…'}
      </Text>
    )
  }
  if (state.phase === 'shutDown') {
    return (
      <Text size="2" color="gray">
        slskd is shut down. This page reconnects once it's started again.
      </Text>
    )
  }
  if (state.error === undefined) return null
  return (
    <Text size="2" color="red">
      {state.error}
    </Text>
  )
}

function PendingCallouts({ data, known }: { data: Application; known: boolean }) {
  const reconnecting = useRun()
  const rescanning = useRun()
  if (!data.pendingRestart && !data.pendingReconnect && !data.scanPending) return null
  return (
    <Flex direction="column" gap="2">
      {data.pendingRestart && (
        <PendingCallout>
          <Callout.Text>Changed settings apply after a restart.</Callout.Text>
          <RestartButton known={known} color="amber" />
        </PendingCallout>
      )}
      {data.pendingReconnect && (
        <PendingCallout error={reconnecting.error}>
          <Callout.Text>Changed Soulseek settings apply after a reconnect.</Callout.Text>
          <ActionButton
            label="Reconnect"
            busy="Reconnecting"
            color="amber"
            loading={reconnecting.running}
            gate={known ? undefined : 'Soulseek status unknown'}
            onClick={() => reconnecting.run(reconnect)}
          />
        </PendingCallout>
      )}
      {data.scanPending && (
        // TODO: move rescanning to the shares tab (README roadmap: System shares)
        <PendingCallout error={rescanning.error}>
          {data.scanning ? (
            <Callout.Text>Scanning shares… {Math.floor(data.scanProgress * 100)}%</Callout.Text>
          ) : (
            <>
              <Callout.Text>Shares need a rescan.</Callout.Text>
              <ActionButton
                label="Rescan"
                busy="Rescanning"
                color="amber"
                loading={rescanning.running}
                gate={known ? undefined : outOfDate}
                onClick={() => rescanning.run(() => api.put('shares'))}
              />
            </>
          )}
        </PendingCallout>
      )}
    </Flex>
  )
}

function PendingCallout({ error, children }: { error?: string; children: ReactNode }) {
  return (
    // Callout is a grid that sizes its columns to their content, so a flex row lets the action sit at the far end.
    <Callout.Root color="amber" size="1" style={{ display: 'flex' }}>
      <Callout.Icon>
        <ExclamationTriangleIcon />
      </Callout.Icon>
      <Flex direction="column" gap="1" flexGrow="1">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          {children}
        </Flex>
        {error !== undefined && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
      </Flex>
    </Callout.Root>
  )
}

function describePrivileges(seconds: number) {
  if (seconds <= 0) return 'Not privileged'
  const days = Math.round(seconds / 86_400)
  if (days >= 1) return `About ${plural(days, 'day')} left`
  return `About ${plural(Math.max(1, Math.round(seconds / 3600)), 'hour')} left`
}

function AccountCard({ data }: { data: Application }) {
  return (
    <Section title="Soulseek account">
      <DetailList
        rows={[
          ['Username', data.username ?? 'None'],
          ['Privileges', describePrivileges(data.privilegeSeconds)],
          ['Shared files', data.sharedFiles.toLocaleString()],
          ['Shared folders', data.sharedFolders.toLocaleString()],
          ['Upload speed', formatSpeed(data.uploadSpeed)],
          ['Uploads', data.uploads.toLocaleString()],
        ]}
      />
      <Flex align="center" gap="3" wrap="wrap">
        {data.username === undefined ? (
          <ActionButton label="Get privileges" busy="" gate="No Soulseek username" onClick={() => {}} />
        ) : (
          <Button asChild size="1" variant="soft">
            <a
              href={`https://www.slsknet.org/qtlogin.php?username=${encodeURIComponent(data.username)}`}
              target="_blank"
              rel="noreferrer"
            >
              Get privileges
            </a>
          </Button>
        )}
        <Text size="1" color="gray">
          New privileges show after a reconnect.
        </Text>
      </Flex>
    </Section>
  )
}

function SearchesCard({ data }: { data: Application }) {
  return (
    <Section title="Incoming searches">
      <DetailList
        rows={[
          ['Latency', `${data.searchLatency.toFixed(1)} ms`],
          ['Queue', data.searchQueue.toLocaleString()],
          ['Dropped', `${data.searchDrops.toLocaleString()} this minute`],
        ]}
      />
    </Section>
  )
}

function NetworkCard({ data }: { data: Application }) {
  return (
    <Section title="Distributed network">
      <DetailList
        rows={[
          ['Parent', data.parent ?? 'None'],
          ['Branch level', data.branchLevel.toLocaleString()],
          ['Branch root', data.branchRoot ?? 'None'],
          [
            'Children',
            `${data.children.toLocaleString()} of ${data.childLimit.toLocaleString()}${data.acceptsChildren ? '' : ', not accepting more'}`,
          ],
        ]}
      />
    </Section>
  )
}
