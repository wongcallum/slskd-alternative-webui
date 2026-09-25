import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { useAppearance } from '../../app/theme'
import { yamlColors } from '../../ui/YamlView'
import type { Problem } from './check'

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--gray-12)', backgroundColor: 'transparent', fontSize: 'var(--font-size-2)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--code-font-family)', lineHeight: 'var(--line-height-2)' },
  '.cm-content': { caretColor: 'var(--accent-11)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-11)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--accent-a5)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--gray-a2)' },
  '.cm-gutters': { backgroundColor: 'var(--color-background)', color: 'var(--gray-9)', border: 'none' },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-panel-solid)',
    border: '1px solid var(--gray-a6)',
    borderRadius: 'var(--radius-2)',
    color: 'var(--gray-12)',
  },
  '.cm-diagnostic': { fontFamily: 'var(--default-font-family)' },
  '.cm-panels': { backgroundColor: 'var(--color-panel-solid)', color: 'var(--gray-12)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--gray-a5)' },
  '.cm-textfield': {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--gray-a7)',
    borderRadius: 'var(--radius-2)',
    color: 'var(--gray-12)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--gray-a3)',
    border: 'none',
    borderRadius: 'var(--radius-2)',
    color: 'var(--gray-12)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--amber-a5)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--amber-a8)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--red-9)' },
})

// The YAML mode tags every unquoted value the same, so they all take the colour of strings.
const highlighting = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: yamlColors.key },
  { tag: [tags.string, tags.special(tags.string), tags.content], color: yamlColors.string },
  { tag: tags.lineComment, color: yamlColors.comment },
  { tag: [tags.labelName, tags.typeName, tags.keyword, tags.meta], color: yamlColors.literal },
])

type Props = {
  value: string
  readOnly: boolean
  problems: readonly Problem[]
  onChange: (value: string) => void
  // Ctrl/Cmd-S always stops the browser's Save page dialog, whether or not this saves.
  onSave: () => void
}

export function YamlEditor({ value, readOnly, problems, onChange, onSave }: Props) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const editable = useRef(new Compartment())
  const dark = useRef(new Compartment())
  const appearance = useAppearance()
  const handlers = useRef({ onChange, onSave })
  useLayoutEffect(() => {
    handlers.current = { onChange, onSave }
  })

  useEffect(() => {
    const created = new EditorView({
      parent: parent.current ?? undefined,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          EditorState.tabSize.of(2),
          indentUnit.of('  '),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                handlers.current.onSave()
                return true
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          // CodeMirror only draws the lines near the viewport, so the browser's own find misses the rest.
          search({ top: true }),
          yaml(),
          syntaxHighlighting(highlighting),
          lintGutter(),
          theme,
          editable.current.of(EditorState.readOnly.of(readOnly)),
          dark.current.of(EditorView.darkTheme.of(appearance === 'dark')),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = created
    return () => {
      created.destroy()
      view.current = null
    }
    // The editor is made once, and follows the props below.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const current = view.current
    if (current === null || current.state.doc.toString() === value) return
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    view.current?.dispatch({ effects: dark.current.reconfigure(EditorView.darkTheme.of(appearance === 'dark')) })
  }, [appearance])

  useEffect(() => {
    const current = view.current
    if (current === null) return
    const length = current.state.doc.length
    const diagnostics = problems.map(({ from, to, message }) => ({
      from: Math.min(from, length),
      to: Math.min(Math.max(from, to), length),
      severity: 'error' as const,
      message,
    }))
    current.dispatch(setDiagnostics(current.state, diagnostics))
  }, [problems])

  return <div ref={parent} style={{ height: '100%' }} />
}
