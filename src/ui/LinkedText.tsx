import { Link } from '@radix-ui/themes'
import Linkify from 'linkify-react'
import type { Opts } from 'linkifyjs'

// Only explicit web links: bare names like "album.fm" are common in file talk.
const options: Opts = {
  validate: { url: (value) => /^(https?:\/\/|www\.)/i.test(value), email: false },
  render: ({ attributes, content }) => (
    <Link href={attributes.href as string} target="_blank" rel="noopener noreferrer">
      {content}
    </Link>
  ),
}

export const LinkedText = ({ children }: { children: string }) => <Linkify options={options}>{children}</Linkify>
