import { marked } from 'marked'
import DOMPurify from 'dompurify'
import removeMd from 'remove-markdown'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import dart from 'highlight.js/lib/languages/dart'

hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('dart', dart)

const LANG_ALIAS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
  js: 'javascript', jsx: 'javascript', javascript: 'javascript',
  py: 'python', python: 'python',
  dart: 'dart',
}

function escapeHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const raw = text == null ? '' : String(text)
      const code = raw.replace(/\n$/, '') + '\n'
      const langString = (lang || '').match(/^\S*/)?.[0] || ''
      const normalized = langString ? LANG_ALIAS[langString.toLowerCase()] || langString.toLowerCase() : null
      let highlighted: string
      try {
        if (normalized && hljs.getLanguage(normalized)) {
          highlighted = hljs.highlight(code, { language: normalized }).value
        } else {
          highlighted = hljs.highlightAuto(code).value
        }
      } catch {
        highlighted = escapeHtml(code)
      }
      return `<pre><code class="hljs">${highlighted}</code></pre>\n`
    },
  },
})

// Allow hljs classes through DOMPurify
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'class') {
    // Allow hljs-* and language-* classes
    data.forceKeepAttr = true
  }
})

export function renderMarkdown(md: string | null | undefined): string {
  if (md == null || md === '') return '<div class="md-content"></div>'
  let html: string
  try {
    html = marked.parse(String(md), { async: false }) as string
  } catch {
    html = `<p>${escapeHtml(String(md))}</p>`
  }
  const safe = DOMPurify.sanitize(html, {
    ADD_TAGS: ['pre', 'code'],
    ADD_ATTR: ['class'],
  })
  return `<div class="md-content">${safe}</div>`
}

export function stripMarkdownPreview(md: string | null | undefined): string {
  if (md == null || md === '') return ''
  try {
    return removeMd(String(md), { gfm: true, useImgAltText: true }).replace(/\s+/g, ' ').trim()
  } catch {
    return String(md).replace(/\s+/g, ' ').trim()
  }
}
