import { Link } from '@radix-ui/themes'
import Linkify from 'linkify-react'
import type { Opts } from 'linkifyjs'

import { useRowTabIndex } from './listNav'

// Only explicit web links, since chat about files is full of names like "album.fm".
const validate: Opts['validate'] = { url: (value) => /^(https?:\/\/|www\.)/i.test(value), email: false }

const optionsFor = (tabIndex?: number): Opts => ({
  validate,
  render: ({ attributes, content }) => (
    <Link href={attributes.href as string} target="_blank" rel="noopener noreferrer" tabIndex={tabIndex}>
      {content}
    </Link>
  ),
})

const tabbable = optionsFor()

const untabbable = optionsFor(-1)

export function LinkedText({ children }: { children: string }) {
  return <Linkify options={useRowTabIndex() === undefined ? tabbable : untabbable}>{children}</Linkify>
}
