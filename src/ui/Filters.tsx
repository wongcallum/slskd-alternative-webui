import { MixerHorizontalIcon } from '@radix-ui/react-icons'
import { Button, Flex, Grid, IconButton, Popover, Text, TextField } from '@radix-ui/themes'
import { type ReactNode, useId, useState } from 'react'
import * as v from 'valibot'

import { countCriteria, type CriteriaSearch, noCriteria, qualities } from '../lib/criteria'
import { positiveDecimal, positiveInteger } from '../lib/params'
import { CheckboxField, ChoiceSelect, Tip } from './controls'

type FiltersProps = {
  filters: CriteriaSearch
  onChange: (patch: Partial<CriteriaSearch>) => void
  active?: number
  onClear?: () => void
  fields?: ReactNode
  children?: ReactNode
  compact?: boolean
}

export function FiltersButton({
  filters,
  onChange,
  active = countCriteria(filters),
  onClear,
  fields,
  children,
  compact = false,
}: FiltersProps) {
  const qualityId = useId()
  const label = active > 0 ? `Filters (${active})` : 'Filters'
  const color = active > 0 ? undefined : 'gray'
  return (
    <Popover.Root>
      {compact ? (
        <Tip content={label} tap={false}>
          <Popover.Trigger>
            <IconButton size="1" variant={active > 0 ? 'soft' : 'ghost'} color={color} aria-label={label}>
              <MixerHorizontalIcon />
            </IconButton>
          </Popover.Trigger>
        </Tip>
      ) : (
        <Popover.Trigger>
          <Button size="1" variant="soft" color={color}>
            <MixerHorizontalIcon />
            {label}
          </Button>
        </Popover.Trigger>
      )}
      <Popover.Content width="320px">
        <Grid columns="auto 1fr" gap="3" align="center">
          <Text as="label" size="2" htmlFor={qualityId}>
            Quality at least
          </Text>
          <ChoiceSelect
            id={qualityId}
            size="1"
            choices={qualities}
            value={filters.quality}
            onChange={(quality) => onChange({ quality })}
          />
          <AmountField
            label="Min file size"
            unit="MiB"
            value={filters.size}
            schema={positiveDecimal}
            onChange={(size) => onChange({ size })}
          />
          <AmountField
            label="Min length"
            unit="min"
            value={filters.length}
            schema={positiveDecimal}
            onChange={(length) => onChange({ length })}
          />
          {fields}
        </Grid>
        <Flex justify="between" align="center" gap="3" mt="4">
          <Flex direction="column" gap="3">
            <CheckboxField
              checked={filters.lossy === 'only'}
              onChange={(checked) => onChange({ lossy: checked ? 'only' : 'all' })}
            >
              Lossy only
            </CheckboxField>
            {children}
          </Flex>
          <Button
            size="1"
            variant="soft"
            color="gray"
            disabled={active === 0}
            onClick={onClear ?? (() => onChange(noCriteria))}
          >
            Clear
          </Button>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  )
}

type AmountProps = {
  label: string
  unit?: string
  value: string
  schema: typeof positiveDecimal | typeof positiveInteger
  onChange: (value: string) => void
}

// While focused, the field shows what's typed rather than the URL, which the router updates a little after each
// keystroke. Following it would put stale values back into the field.
export function AmountField({ label, unit, value, schema, onChange }: AmountProps) {
  const id = useId()
  const [draft, setDraft] = useState<string>()
  const text = draft ?? value
  const invalid = text.trim() !== '' && !v.is(schema, text.trim())
  return (
    <>
      <Text as="label" size="2" htmlFor={id}>
        {label}
      </Text>
      <TextField.Root
        id={id}
        size="1"
        inputMode="decimal"
        color={invalid ? 'red' : undefined}
        aria-invalid={invalid}
        value={text}
        onFocus={() => setDraft(value)}
        onBlur={() => setDraft(undefined)}
        onChange={(event) => {
          setDraft(event.target.value)
          const amount = event.target.value.trim()
          onChange(v.is(schema, amount) ? String(Number(amount)) : '')
        }}
      >
        {unit !== undefined && <TextField.Slot side="right">{unit}</TextField.Slot>}
      </TextField.Root>
    </>
  )
}
