import './dashboard.css'
import { Box, Card, Flex, Grid, Heading, Inset, Link, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import { lazy, type ReactNode, Suspense, useId } from 'react'

import { formatBytes, formatSpeed, plural } from '../lib/format'
import type { SearchProps } from '../lib/params'
import { useResource } from '../lib/store'
import { NewSearch } from '../search/NewSearch'
import type { Direction } from '../transfers/transfers'
import { type Choices, ChoiceSegments, Toolbar, ToolbarEnd } from '../ui/controls'
import { Empty, Fetching, Freshness } from '../ui/status'
import {
  Cell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  Parts,
  rowHeight,
  StackedRow,
  stackedHeight,
  useListLayout,
} from '../ui/table'
import { UserCell, UserMenu } from '../users/UserMenu'
import { type DashboardSearch, type Measure, type Range, type UserSort, userSorts } from './params'
import { type Folder, type Leader, leaderboards, type Reason, type Report, reports, type Totals } from './reports'

export const loadChart = () => import('./Chart')

const Chart = lazy(async () => ({ default: (await loadChart()).Chart }))

const chartHeight = 240

const rangeChoices: Choices<Range> = [
  ['24h', '24h'],
  ['7d', '7d'],
  ['30d', '30d'],
  ['1y', '1y'],
  ['all', 'All'],
]

const measureChoices: Choices<Measure> = [
  ['size', 'Size'],
  ['files', 'Files'],
  ['failed', 'Failed'],
]

const unitHeadings: Record<Report['unit'], string> = {
  hour: 'By hour',
  sixHours: 'By six hours',
  day: 'By day',
  month: 'By month',
}

type Props = SearchProps<DashboardSearch>

export function DashboardPage({ search, onSearchChange }: Props) {
  const resource = reports.get(search.range)
  const { data, error } = useResource(resource)
  let content: ReactNode
  if (data === undefined) {
    content = (
      <Fetching error={error} onRetry={resource.refresh}>
        Can't load the transfer history
      </Fetching>
    )
  } else if (!data.any) content = <Empty>No finished transfers yet.</Empty>
  else content = <History report={data} search={search} onSearchChange={onSearchChange} />
  return (
    <Flex direction="column" height="100%">
      <NewSearch />
      <Toolbar>
        <ChoiceSegments choices={rangeChoices} value={search.range} onChange={(range) => onSearchChange({ range })} />
        <ToolbarEnd>
          <Freshness resource={resource} />
        </ToolbarEnd>
      </Toolbar>
      <Box flexGrow="1" minHeight="0" overflow="auto">
        {content}
      </Box>
    </Flex>
  )
}

function History({ report, search, onSearchChange }: Props & { report: Report }) {
  return (
    <Flex direction="column" gap="4" p="4">
      <TotalsCard totals={report.totals} />
      <Section
        title={unitHeadings[report.unit]}
        actions={
          <ChoiceSegments
            choices={measureChoices}
            value={search.chart}
            onChange={(chart) => onSearchChange({ chart })}
          />
        }
      >
        <Suspense fallback={<Box height={`${chartHeight + 24}px`} />}>
          <Chart bars={report.bars} unit={report.unit} measure={search.chart} height={chartHeight} />
        </Suspense>
      </Section>
      <Grid className="dashboard-cards" columns={{ initial: '1', md: '2' }} gap="4" align="start">
        <LeaderCards range={search.range} sort={search.users} onSort={(users) => onSearchChange({ users })} />
        <FolderCard folders={report.folders} />
        <ReasonCard
          reasons={report.reasons[search.errors]}
          direction={search.errors}
          onDirectionChange={(errors) => onSearchChange({ errors })}
        />
      </Grid>
    </Flex>
  )
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <Card asChild size="2">
      <section aria-labelledby={id}>
        <Flex direction="column" gap="3">
          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Heading as="h2" size="3" id={id}>
              {title}
            </Heading>
            {actions}
          </Flex>
          {children}
        </Flex>
      </section>
    </Card>
  )
}

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumSignificantDigits: 2 })

function TotalsCard({ totals }: { totals: Record<Direction, Totals> }) {
  const ratio = totals.download.bytes === 0 ? undefined : totals.upload.bytes / totals.download.bytes
  return (
    <Card size="2">
      <Grid columns={{ initial: '1', xs: '3' }} gap="4">
        <DirectionTotals label="Downloaded" users="from" totals={totals.download} />
        <Figure label="Share ratio" value={ratio === undefined ? '–' : ratio.toFixed(2)}>
          <Text size="2" color="gray">
            Uploaded ÷ downloaded
          </Text>
        </Figure>
        <DirectionTotals label="Uploaded" users="to" totals={totals.upload} />
      </Grid>
    </Card>
  )
}

function Figure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Text size="6" weight="medium">
        {value}
      </Text>
      {children}
    </Flex>
  )
}

// Cancelled transfers count as neither, so the failure rate is of the transfers that ran their course.
function DirectionTotals({ label, users, totals }: { label: string; users: 'from' | 'to'; totals: Totals }) {
  return (
    <Figure label={label} value={formatBytes(totals.bytes)}>
      <Text size="2">
        {plural(totals.files, 'file')} {users} {plural(totals.users, 'user')}
      </Text>
      {totals.failed > 0 && (
        <Text size="2" color="red">
          {totals.failed.toLocaleString()} failed ({percent.format(totals.failed / (totals.files + totals.failed))})
        </Text>
      )}
    </Figure>
  )
}

type Stacked = { title: ReactNode; meta: ReactNode[] }

// Below sm, each row takes two lines, and only the sorts are left of the header.
function Rows<T>({
  items,
  itemKey,
  template,
  label,
  columns,
  empty,
  renderCells,
  renderStacked,
}: {
  items: readonly T[]
  itemKey: (item: T) => string
  template: string
  label: string
  columns: ReactNode
  empty: string
  renderCells: (item: T) => ReactNode
  renderStacked: (item: T) => Stacked
}) {
  const stacked = useListLayout() === 'stacked'
  if (items.length === 0) {
    return (
      <Text size="2" color="gray">
        {empty}
      </Text>
    )
  }
  return (
    <Inset side="x">
      <HeaderRow columns={template} stacked={stacked}>
        {!stacked && <ColumnHeader label={label} />}
        {columns}
      </HeaderRow>
      {items.map((item) => {
        if (!stacked) {
          return (
            <div key={itemKey(item)} style={{ height: rowHeight }}>
              <GridRow template={template}>{renderCells(item)}</GridRow>
            </div>
          )
        }
        const { title, meta } = renderStacked(item)
        return (
          <div key={itemKey(item)} style={{ height: stackedHeight }}>
            <StackedRow title={title} meta={<Parts items={meta} />} />
          </div>
        )
      })}
    </Inset>
  )
}

const noneInRange = 'None in this range.'

const userColumns: Record<UserSort, string> = { files: 'Files', size: 'Size', speed: 'Speed' }

const leaderTemplate = 'minmax(0, 1fr) 64px 88px 100px'

function LeaderCards({ range, sort, onSort }: { range: Range; sort: UserSort; onSort: (sort: UserSort) => void }) {
  const resource = leaderboards.get({ range, sort })
  const { data, error } = useResource(resource)
  const table = (leaders: readonly Leader[] | undefined) =>
    leaders === undefined ? (
      <Fetching error={error} onRetry={resource.refresh}>
        Can't load the users
      </Fetching>
    ) : (
      <Rows
        items={leaders}
        itemKey={(leader) => leader.username}
        template={leaderTemplate}
        label="User"
        columns={userSorts.map((id) => (
          <ColumnHeader
            key={id}
            label={userColumns[id]}
            end
            column={{
              getIsSorted: () => (id === sort ? 'desc' : false),
              getToggleSortingHandler: () => () => onSort(id),
            }}
          />
        ))}
        empty={noneInRange}
        renderCells={(leader) => (
          <>
            <UserCell username={leader.username} />
            <Cell end>{leader.files.toLocaleString()}</Cell>
            <Cell end>{formatBytes(leader.bytes)}</Cell>
            <Cell end>{formatSpeed(leader.speed)}</Cell>
          </>
        )}
        renderStacked={(leader) => ({
          title: (
            <Text size="2">
              <UserMenu username={leader.username} />
            </Text>
          ),
          meta: [plural(leader.files, 'file'), formatBytes(leader.bytes), formatSpeed(leader.speed)],
        })}
      />
    )
  return (
    <>
      <Section title="Downloaded from">{table(data?.download)}</Section>
      <Section title="Uploaded to">{table(data?.upload)}</Section>
    </>
  )
}

const countTemplate = 'minmax(0, 1fr) 64px 64px'

// The path is cut from the left, so the folder's own name stays in view.
function FolderLink({ path }: { path: string }) {
  return (
    <Link asChild size="2">
      <RouterLink to="/system/shares" search={{ path }}>
        <bdi>{path}</bdi>
      </RouterLink>
    </Link>
  )
}

function FolderCard({ folders }: { folders: readonly Folder[] }) {
  return (
    <Section title="Your most downloaded folders">
      <Rows
        items={folders}
        itemKey={(folder) => folder.path}
        template={countTemplate}
        label="Folder"
        columns={
          <>
            <ColumnHeader label="Users" end />
            <ColumnHeader label="Files" end />
          </>
        }
        empty={noneInRange}
        renderCells={(folder) => (
          <>
            <div className="table-cell dashboard-path" title={folder.path}>
              <FolderLink path={folder.path} />
            </div>
            <Cell end>{folder.users.toLocaleString()}</Cell>
            <Cell end>{folder.files.toLocaleString()}</Cell>
          </>
        )}
        renderStacked={(folder) => ({
          title: (
            <div className="dashboard-path" title={folder.path}>
              <FolderLink path={folder.path} />
            </div>
          ),
          meta: [plural(folder.users, 'user'), plural(folder.files, 'file')],
        })}
      />
    </Section>
  )
}

const directionChoices: Choices<Direction> = [
  ['download', 'Downloads'],
  ['upload', 'Uploads'],
]

function Message({ reason }: { reason: Reason }) {
  return (
    <Text size="2" color={reason.message === undefined ? 'gray' : undefined} truncate title={reason.message}>
      {reason.message ?? 'No message'}
    </Text>
  )
}

function ReasonCard({
  reasons,
  direction,
  onDirectionChange,
}: {
  reasons: readonly Reason[]
  direction: Direction
  onDirectionChange: (direction: Direction) => void
}) {
  return (
    <Section
      title="Errors and cancellations"
      actions={<ChoiceSegments choices={directionChoices} value={direction} onChange={onDirectionChange} />}
    >
      <Rows
        items={reasons}
        itemKey={(reason) => reason.message ?? ''}
        template={countTemplate}
        label="Message"
        columns={
          <>
            <ColumnHeader label="Files" end />
            <ColumnHeader label="Users" end />
          </>
        }
        empty={noneInRange}
        renderCells={(reason) => (
          <>
            <div className="table-cell">
              <Message reason={reason} />
            </div>
            <Cell end>{reason.files.toLocaleString()}</Cell>
            <Cell end>{reason.users.toLocaleString()}</Cell>
          </>
        )}
        renderStacked={(reason) => ({
          title: <Message reason={reason} />,
          meta: [plural(reason.files, 'file'), plural(reason.users, 'user')],
        })}
      />
    </Section>
  )
}
