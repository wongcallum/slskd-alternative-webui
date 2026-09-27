import { Box, Button, Card, Flex, Grid, Heading, Link, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'

import { version } from '../../package.json'
import { api, describeError } from '../lib/api'
import { formatAge, formatBytes, formatSpeed, plural } from '../lib/format'
import { useAtom, useClock, useResource } from '../lib/store'
import { useRun } from '../lib/useRun'
import { ActionButton, ConfirmButton, type Detail, DetailList } from '../ui/controls'
import { Freshness, Polling } from '../ui/status'
import { type Application, application, applicationPollInterval, releaseNotes, useApplication } from './application'
import { lifecycle, restartPatience, shutDown } from './lifecycle'
import { PendingCallouts, RestartButton, useLifecycleGate } from './PendingCallouts'
import { processInfo } from './process'
import { SystemPage } from './SystemPage'

export function InfoPage() {
  const { data, error, live, known } = useApplication()
  return (
    <SystemPage status={<Freshness resource={application} interval={applicationPollInterval} live={live} />}>
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

function SlskdCard({ data, known }: { data: Application; known: boolean }) {
  const { data: process, error: processError } = useResource(processInfo)
  const gate = useLifecycleGate(known)
  const check = useRun()

  let latest: ReactNode = 'Not checked'
  if (data.updateAvailable && data.latest !== undefined) {
    latest = (
      <Flex as="span" gap="3" wrap="wrap">
        <span>{data.latest} is available</span>
        <Link href={releaseNotes(data.latest)} target="_blank" rel="noreferrer">
          Release notes
        </Link>
      </Flex>
    )
  } else if (data.latest !== undefined && data.build === undefined) latest = 'Up to date'

  const rows: Detail[] = [
    ['Version', data.build === undefined ? data.version : `${data.version} (${data.build} build)`],
    ['Latest', latest],
    ['Web UI', version],
  ]
  if (process?.startedAt !== undefined) rows.push(['Uptime', <Uptime key="uptime" startedAt={process.startedAt} />])
  if (process?.runtime !== undefined) rows.push(['Runtime', process.runtime])
  if (process?.architecture !== undefined) rows.push(['Architecture', process.architecture])
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
          loading={check.running}
          gate={checkGate}
          onClick={() => check.run(() => api.get('application/version/latest', { searchParams: { forceCheck: true } }))}
        />
        <RestartButton known={known} />
        <ConfirmButton
          label="Shut down"
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
          <ActionButton label="Get privileges" gate="No Soulseek username" onClick={() => {}} />
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
