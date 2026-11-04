import { Box, Button, Callout, Flex, SegmentedControl, Text } from '@radix-ui/themes'
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from 'react'

import { describeError } from '../../lib/api'
import { pendingItems, useApplication } from '../../lib/application'
import type { SearchProps } from '../../lib/params'
import { useAtom, useResource } from '../../lib/store'
import { ActionButton, barHeight, disabledProps, Tip, toolbarStyle } from '../../ui/controls'
import { Preformatted } from '../../ui/details'
import { Fetched, FetchedResource, Freshness, Loading, Polling } from '../../ui/status'
import { YamlView } from '../../ui/YamlView'
import { PendingCallout, PendingCallouts } from '../PendingCallouts'
import { SystemPage } from '../SystemPage'
import { type Check, checkConfig } from './check'
import {
  type ConfigFile,
  configFile,
  discard,
  edit,
  readFile,
  save,
  sources,
  sourcesLoading,
  validate,
} from './configFile'
import { effectiveYaml, misspelt } from './effective'
import { type Options, options, optionsPollInterval, startupOptions, useLiveOptions } from './options'
import { type OptionsSearch, type OptionView, optionViews } from './params'

// CodeMirror has a chunk of its own, since most installs can't edit their file from here at all.
const YamlEditor = lazy(() => import('./YamlEditor').then((module) => ({ default: module.YamlEditor })))

const viewLabels: Record<OptionView, string> = { effective: 'Effective', file: 'File', sources: 'Sources' }

const checking = "Checking slskd's options"

const checkingStart = 'Checking how slskd was started'

// A gate that's only waiting for an answer shows as loading, not as a reason.
const waiting = (gate: string | undefined) => gate === checking || gate === checkingStart

const remoteOff = "slskd's remote_configuration is off"

function fileGate(data: Options | undefined) {
  if (data === undefined) return checking
  return data.remoteConfiguration ? undefined : remoteOff
}

function sourcesGate(data: Options | undefined, startup: { data?: { debug: boolean }; error?: unknown }) {
  const gate = fileGate(data)
  if (gate !== undefined) return gate
  if (startup.data === undefined) {
    return startup.error === undefined
      ? checkingStart
      : `Can't tell how slskd was started: ${describeError(startup.error)}`
  }
  return startup.data.debug ? undefined : "slskd wasn't started with debug on"
}

type Props = SearchProps<OptionsSearch>

export function OptionsPage({ search, onSearchChange }: Props) {
  const live = useLiveOptions()
  const startup = useResource(startupOptions)
  const gates: Record<OptionView, string | undefined> = {
    effective: undefined,
    file: fileGate(live.data),
    sources: sourcesGate(live.data, startup),
  }
  const control = <ViewControl view={search.view} gates={gates} onChange={(view) => onSearchChange({ view })} />
  if (search.view === 'file') return <FileView control={control} gate={gates.file} known={live.known} />
  if (search.view === 'sources') return <SourcesView control={control} gate={gates.sources} />
  return (
    <SystemPage status={<Freshness resource={options} interval={optionsPollInterval} live={live.live} />}>
      <Toolbar control={control} />
      <EffectiveView data={live.data} error={live.error} />
    </SystemPage>
  )
}

// The view that's open stays selected when it becomes unavailable, so a draft stays in front of whoever wrote it.
function ViewControl({
  view,
  gates,
  onChange,
}: {
  view: OptionView
  gates: Record<OptionView, string | undefined>
  onChange: (view: OptionView) => void
}) {
  return (
    <SegmentedControl.Root
      size="1"
      value={view}
      onValueChange={(next) => {
        const chosen = next as OptionView
        if (gates[chosen] === undefined) onChange(chosen)
      }}
    >
      {optionViews.map((id) => {
        const gate = gates[id]
        if (gate === undefined) {
          return (
            <SegmentedControl.Item key={id} value={id}>
              {viewLabels[id]}
            </SegmentedControl.Item>
          )
        }
        // The tooltip goes inside, since its trigger's data-state would replace the item's.
        return (
          <SegmentedControl.Item key={id} value={id} {...disabledProps(true)} style={{ color: 'var(--gray-a9)' }}>
            <Tip content={gate}>
              <span>{viewLabels[id]}</span>
            </Tip>
          </SegmentedControl.Item>
        )
      })}
    </SegmentedControl.Root>
  )
}

function Toolbar({ control, children }: { control: ReactNode; children?: ReactNode }) {
  const { data, known } = useApplication()
  return (
    <>
      <Flex
        align="center"
        gap="3"
        px="4"
        py="2"
        flexShrink="0"
        minHeight={`${barHeight}px`}
        wrap="wrap"
        style={toolbarStyle}
      >
        {control}
        <Flex ml="auto" align="center" gap="3" minWidth="0">
          {children}
        </Flex>
      </Flex>
      {data !== undefined && pendingItems(data).length > 0 && (
        <Box px="4" pt="3" flexShrink="0">
          <PendingCallouts data={data} known={known} />
        </Box>
      )}
    </>
  )
}

function Scroll({ children }: { children: ReactNode }) {
  return (
    <Box flexGrow="1" minHeight="0" overflow="auto" px="4" py="3">
      {children}
    </Box>
  )
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <Box px="4" pt="3" flexShrink="0">
      <Callout.Root color="gray" size="1">
        <Callout.Text>{children}</Callout.Text>
      </Callout.Root>
    </Box>
  )
}

function EffectiveView({ data, error }: { data?: Options; error: unknown }) {
  const settings = data?.settings
  const source = useMemo(() => settings && effectiveYaml(settings), [settings])
  if (source === undefined) return <Polling what="slskd's options" error={error} />
  return (
    <Scroll>
      <YamlView source={source} />
    </Scroll>
  )
}

// Asked about 500 ms after typing stops. An answer for text that has since changed is dropped.
function useSlskdCheck(text: string | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ text: string; message?: string; error?: string }>()
  useEffect(() => {
    if (text === undefined || !enabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      validate(text, controller.signal).then(
        (message) => setResult({ text, message }),
        (error: unknown) => {
          if (!controller.signal.aborted) setResult({ text, error: describeError(error) })
        },
      )
    }, 500)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [text, enabled])
  return result?.text === text ? result : undefined
}

type SlskdCheck = ReturnType<typeof useSlskdCheck>

function saveGate(file: ConfigFile, gate: string | undefined, known: boolean, check?: Check, slskd?: SlskdCheck) {
  if (gate !== undefined) return gate
  if (!known) return "slskd's options are out of date"
  if (file.draft === undefined || check === undefined) return 'No changes to save'
  if (check.empty) return 'slskd would drop every setting, the Soulseek login included'
  if (check.problems.length > 0) return 'Fix the problems marked in the file first'
  if (file.conflict !== undefined) return 'The file changed on disk'
  if (slskd === undefined) return 'Checking the file with slskd'
  // A check that failed doesn't hold a save back, which slskd validates again anyway.
  if (slskd.message !== undefined) return 'slskd rejects the file'
  return undefined
}

function FileView({ control, gate, known }: { control: ReactNode; gate?: string; known: boolean }) {
  const file = useAtom(configFile)
  const available = gate === undefined
  useEffect(() => {
    if (available) void readFile()
  }, [available])
  const text = file.draft ?? file.base
  const check = useMemo(() => (text === undefined ? undefined : checkConfig(text)), [text])
  const slskd = useSlskdCheck(file.draft, available && check?.syntax === true)
  const blocked = saveGate(file, gate, known, check, slskd)
  const overwriteBlocked = saveGate({ ...file, conflict: undefined }, gate, known, check, slskd)
  const dirty = file.draft !== undefined

  let content: ReactNode
  if (text === undefined) {
    if (waiting(gate)) content = <Loading />
    else if (!available) content = <Unavailable>{gate}, so the file can't be read or saved here.</Unavailable>
    else if (file.readError !== undefined)
      content = <Unavailable>Can't read the file: {describeError(file.readError)}</Unavailable>
    else content = <Loading />
  } else {
    content = (
      <>
        {!available && (
          <Unavailable>{gate}, so the file can't be read or saved here. What's below can still be copied.</Unavailable>
        )}
        {available && file.conflict !== undefined && <ConflictCallout gate={overwriteBlocked} saving={file.saving} />}
        <Box flexGrow="1" minHeight="0" mt="2">
          <Suspense fallback={<Loading />}>
            <YamlEditor
              value={text}
              readOnly={!available}
              problems={check?.problems ?? []}
              onChange={edit}
              onSave={() => {
                if (blocked === undefined) void save()
              }}
            />
          </Suspense>
        </Box>
        <FileStatus file={file} check={check} slskd={slskd} />
      </>
    )
  }

  return (
    <SystemPage
      status={
        <Fetched
          fetchedAt={file.readAt}
          error={file.base === undefined ? undefined : file.readError}
          loading={file.reading}
          label={dirty ? 'Discard my changes' : 'Reload'}
          gate={gate ?? (file.saving ? 'Saving' : undefined)}
          onRefresh={dirty ? discard : () => void readFile()}
        />
      }
    >
      <Toolbar control={control}>
        {file.location !== undefined && (
          <Text size="1" color="gray" truncate title={file.location}>
            {file.location}
          </Text>
        )}
        <ActionButton label="Save" loading={file.saving} gate={blocked} onClick={() => void save()} />
      </Toolbar>
      {content}
    </SystemPage>
  )
}

function ConflictCallout({ gate, saving }: { gate?: string; saving: boolean }) {
  return (
    <Box px="4" pt="3" flexShrink="0">
      <PendingCallout>
        <Callout.Text>The file changed on disk since it was read.</Callout.Text>
        <Flex gap="2">
          <ActionButton
            label="Overwrite"
            loading={saving}
            gate={gate}
            color="amber"
            onClick={() => void save({ overwrite: true })}
          />
          <Tip content={saving ? 'Saving' : undefined}>
            <Button size="1" variant="soft" color="gray" {...disabledProps(saving)} onClick={discard}>
              Discard my changes
            </Button>
          </Tip>
        </Flex>
      </PendingCallout>
    </Box>
  )
}

function FileStatus({ file, check, slskd }: { file: ConfigFile; check?: Check; slskd?: SlskdCheck }) {
  const lines: ReactNode[] = []
  if (check?.empty === true) {
    lines.push(
      <Text key="empty" size="2" color="red">
        The file has no settings. Saving it would make slskd drop every setting, the Soulseek login included.
      </Text>,
    )
  }
  for (const problem of check?.problems ?? []) {
    lines.push(
      <Text key={problem.from} size="2" color="red">
        Line {problem.line}, column {problem.column}: {problem.message}
      </Text>,
    )
  }
  if (slskd?.message !== undefined) {
    const hint = misspelt.find(([name]) => slskd.message?.includes(`'${name}'`))
    lines.push(
      <Box key="slskd">
        <Text size="2" color="red">
          slskd rejects the file:
        </Text>
        <Preformatted>{slskd.message}</Preformatted>
        {hint !== undefined && (
          <Text size="2" color="gray">
            slskd's validator only accepts <code>{hint[1]}</code> for <code>{hint[0]}</code>.
          </Text>
        )}
      </Box>,
    )
  }
  if (slskd?.error !== undefined) {
    lines.push(
      <Text key="error" size="2" color="red">
        slskd couldn't check the file: {slskd.error}
      </Text>,
    )
  }
  if (file.saveMessage !== undefined) {
    lines.push(
      <Text key="save" size="2" color="red">
        Couldn't save: {file.saveMessage}
      </Text>,
    )
  }
  if (file.saved) {
    lines.push(
      <Text key="saved" size="2" color="gray">
        Saved. slskd kept the previous file as {file.location ?? 'the file'}.bak.
      </Text>,
    )
  }
  if (lines.length === 0) return null
  return (
    <Flex
      direction="column"
      gap="1"
      px="4"
      py="2"
      flexShrink="0"
      maxHeight="30%"
      overflow="auto"
      style={{ boxShadow: 'inset 0 1px 0 0 var(--gray-a5)' }}
    >
      {lines}
    </Flex>
  )
}

// Each line is "key=value (Provider)", and the provider is what shows where a value came from.
const providerPattern = /^(.*?)( \([A-Za-z]+ConfigurationProvider.*\))$/

function SourcesView({ control, gate }: { control: ReactNode; gate?: string }) {
  return gate === undefined ? (
    <SourcesContent control={control} />
  ) : waiting(gate) ? (
    <SystemPage>
      <Toolbar control={control} />
      <Loading />
    </SystemPage>
  ) : (
    <SystemPage>
      <Toolbar control={control} />
      <Unavailable>{gate}, so it can't show where each setting came from.</Unavailable>
    </SystemPage>
  )
}

function SourcesContent({ control }: { control: ReactNode }) {
  const { data, error } = useResource(sources)
  const lines = useMemo(() => data?.text.split('\n').map((line) => providerPattern.exec(line) ?? [line, line]), [data])
  return (
    <SystemPage status={<FetchedResource resource={sources} loading={sourcesLoading} label="Reload" />}>
      <Toolbar control={control}>
        <Text size="1" color="gray">
          Secrets are shown in plain text.
        </Text>
      </Toolbar>
      {lines === undefined ? (
        <Polling what="where slskd's settings came from" error={error} />
      ) : (
        <Scroll>
          <Preformatted>
            {lines.map(([, setting, provider], index) => (
              // oxlint-disable-next-line react/no-array-index-key -- the lines never reorder
              <span key={index}>
                {setting}
                {provider !== undefined && <span style={{ color: 'var(--gray-9)' }}>{provider}</span>}
                {'\n'}
              </span>
            ))}
          </Preformatted>
        </Scroll>
      )}
    </SystemPage>
  )
}
