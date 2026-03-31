import { useMemo } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { cn } from '../lib/utils'

interface Props {
  content: string | null | undefined
  className?: string
}

export function MarkdownRender({ content, className }: Props) {
  const html = useMemo(() => renderMarkdown(content), [content])
  return (
    <div
      className={cn(className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
