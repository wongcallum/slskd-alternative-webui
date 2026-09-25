import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { describeError } from '../lib/api'
import { createSearch, hasSearchTerm } from './searches'

// A new search opens its results, unless the page was left while slskd was creating it.
export function useCreateSearch() {
  const navigate = useNavigate()
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function create(text: string) {
    if (!hasSearchTerm(text)) {
      setState({
        busy: false,
        error: 'Add a word to search for. Words starting with - only exclude, and single characters are ignored.',
      })
      return
    }
    setState({ busy: true })
    try {
      const id = await createSearch(text)
      if (mounted.current) void navigate({ to: '/searches/$id', params: { id } })
    } catch (thrown) {
      if (mounted.current) setState({ busy: false, error: describeError(thrown) })
    }
  }

  return { ...state, create }
}
