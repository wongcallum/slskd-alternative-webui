import { MixerHorizontalIcon } from '@radix-ui/react-icons'
import { Button, Checkbox, Flex, Grid, Popover, Select, Text, TextField } from '@radix-ui/themes'
import { useId, useState } from 'react'
import * as v from 'valibot'
import { positiveDecimal, positiveInteger } from '../../lib/params'
import { countFilters, type FilterSearch, noFilters, qualities } from './params'

type FiltersProps = { filters: FilterSearch; onChange: (patch: Partial<FilterSearch>) => void }

export function FiltersButton({ filters, onChange }: FiltersProps) {
  const active = countFilters(filters)
  const qualityId = useId()
  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button size="1" variant="soft" color={active > 0 ? undefined : 'gray'}>
          <MixerHorizontalIcon />
          {active > 0 ? `Filters (${active})` : 'Filters'}
        </Button>
      </Popover.Trigger>
      <Popover.Content width="320px">
        <Grid columns="auto 1fr" gap="3" align="center">
          <Text as="label" size="2" htmlFor={qualityId}>
            Quality at least
          </Text>
          <Select.Root
            size="1"
            value={filters.quality}
            onValueChange={(quality) => onChange({ quality: quality as FilterSearch['quality'] })}
          >
            <Select.Trigger id={qualityId} />
            <Select.Content>
              {qualities.map(([value, label]) => (
                <Select.Item key={value} value={value}>
                  {label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
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
          <AmountField
            label="Min files per folder"
            value={filters.files}
            schema={positiveInteger}
            onChange={(files) => onChange({ files })}
          />
        </Grid>
        <Flex justify="between" align="center" mt="4">
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox
                checked={filters.free === 'only'}
                onCheckedChange={(checked) => onChange({ free: checked === true ? 'only' : 'all' })}
              />
              Free slot only
            </Flex>
          </Text>
          <Button size="1" variant="soft" color="gray" disabled={active === 0} onClick={() => onChange(noFilters)}>
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
function AmountField({ label, unit, value, schema, onChange }: AmountProps) {
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
