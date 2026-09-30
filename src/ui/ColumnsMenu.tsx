import { ColumnsIcon } from '@radix-ui/react-icons'
import { DropdownMenu, Flex, IconButton } from '@radix-ui/themes'

import { Tip } from './controls'
import { RowScope } from './listNav'
import { type Columns, hideable, setHidden } from './widths'

// Hiding a column hides it in every table of the kind. The menu only lists and counts what its table's layout has,
// so showing all leaves hidden a column that another layout or transfer section has.
export function ColumnsMenu({ columns, labels }: { columns: Columns; labels: Readonly<Record<string, string>> }) {
  const { table, all, hidden } = columns
  const keys = all.flatMap((track, index) => (hideable(all, index) && track.key !== undefined ? [track.key] : []))
  const count = keys.filter((key) => hidden.includes(key)).length
  const label = count === 0 ? 'Columns' : `Columns (${count} hidden)`
  const toggle = (key: string, shown: boolean) =>
    setHidden(table, shown ? hidden.filter((each) => each !== key) : [...hidden, key])
  const showAll = () =>
    setHidden(
      table,
      hidden.filter((key) => !keys.includes(key)),
    )
  return (
    <Flex className="table-cell" align="center" justify="end">
      {/* A transfer section's header is an item in its list, where only the focused row is in the Tab order. */}
      <RowScope tabbable>
        <DropdownMenu.Root>
          <Tip content={label} tap={false}>
            <DropdownMenu.Trigger>
              <IconButton
                size="1"
                variant={count > 0 ? 'soft' : 'ghost'}
                color={count > 0 ? undefined : 'gray'}
                aria-label={label}
              >
                <ColumnsIcon />
              </IconButton>
            </DropdownMenu.Trigger>
          </Tip>
          <DropdownMenu.Content>
            {keys.map((key) => (
              <DropdownMenu.CheckboxItem
                key={key}
                checked={!hidden.includes(key)}
                onCheckedChange={(checked) => toggle(key, checked)}
                // Several columns are often toggled at once.
                onSelect={(event) => event.preventDefault()}
              >
                {labels[key]}
              </DropdownMenu.CheckboxItem>
            ))}
            <DropdownMenu.Separator />
            <DropdownMenu.Item disabled={count === 0} onSelect={showAll}>
              Show all columns
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </RowScope>
    </Flex>
  )
}
