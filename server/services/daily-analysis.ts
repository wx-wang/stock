import { promises as fs } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

const DAILY_DIR = path.resolve(process.cwd(), 'content/daily-analysis')

export interface DailyAnalysisMeta {
  slug: string
  title: string
  date: string
  generatedAt: string
  summary: string
  tags: string[]
  wordCount: number
}

export interface DailyAnalysisDetail extends DailyAnalysisMeta {
  html: string
  markdown: string
}

function stripExt(file: string): string {
  return file.replace(/\.md$/i, '')
}

function normalizeDate(input: unknown, content: string): string {
  const fromMeta = input ? String(input).trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromMeta)) return fromMeta

  const matched = content.match(/数据基准[：:]\s*(\d{4}[-/]\d{2}[-/]\d{2})/)
    || content.match(/交易日[：:]\s*(\d{4}[-/]\d{2}[-/]\d{2})/)
    || content.match(/(\d{4}[-/]\d{2}[-/]\d{2})/)
  return matched ? matched[1].replace(/\//g, '-') : ''
}

function normalizeGeneratedAt(input: unknown, content: string): string {
  const fromMeta = input ? String(input).trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromMeta)) return fromMeta

  const matched = content.match(/生成日期[：:]\s*(\d{4}[-/]\d{2}[-/]\d{2})/)
  return matched ? matched[1].replace(/\//g, '-') : ''
}

function titleFromContent(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim()
  return fallback.replace(/[-_]/g, ' ')
}

function normalizeTags(input: unknown, content: string): string[] {
  if (Array.isArray(input)) return input.map(String).filter(Boolean).slice(0, 8)
  if (typeof input === 'string') return input.split(/[,，、\s]+/).filter(Boolean).slice(0, 8)

  const tags = ['趋势日报']
  if (/知识星球/.test(content)) tags.push('知识星球')
  if (/趋势动物/.test(content)) tags.push('趋势动物')
  if (/温转热|右侧|大盘温度/.test(content)) tags.push('趋势跟踪')
  return tags
}

function summarize(content: string, input: unknown): string {
  if (input) return String(input).trim()

  const plain = content
    .replace(/^---[\s\S]*?---/, '')
    .replace(/^#.+$/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\|.*\|/g, '')
    .replace(/[-*_`#]/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .find(line => line.length >= 24 && !/^(数据基准|生成日期|用途)[：:]/.test(line))

  return plain ? plain.slice(0, 140) : '暂无摘要'
}

function countWords(content: string): number {
  return content.replace(/\s/g, '').length
}

async function readMarkdownFile(file: string): Promise<{ meta: DailyAnalysisMeta; body: string }> {
  const slug = stripExt(file)
  const raw = await fs.readFile(path.join(DAILY_DIR, file), 'utf-8')
  const parsed = matter(raw)
  const content = parsed.content.trim()
  const title = parsed.data.title ? String(parsed.data.title) : titleFromContent(content, slug)

  return {
    body: content,
    meta: {
      slug,
      title,
      date: normalizeDate(parsed.data.date, content),
      generatedAt: normalizeGeneratedAt(parsed.data.generatedAt || parsed.data.generated_at, content),
      summary: summarize(content, parsed.data.summary),
      tags: normalizeTags(parsed.data.tags, content),
      wordCount: countWords(content),
    },
  }
}

export async function listDailyAnalyses(): Promise<DailyAnalysisMeta[]> {
  const files = await fs.readdir(DAILY_DIR).catch(() => [])
  const markdownFiles = files.filter(file => file.endsWith('.md')).sort()
  const reports = await Promise.all(markdownFiles.map(readMarkdownFile))

  return reports
    .map(report => report.meta)
    .sort((a, b) => {
      const byDate = (b.date || '').localeCompare(a.date || '')
      return byDate || a.title.localeCompare(b.title, 'zh-CN')
    })
}

export async function getDailyAnalysis(slug: string): Promise<DailyAnalysisDetail | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return null

  const file = `${slug}.md`
  const files = await fs.readdir(DAILY_DIR).catch(() => [])
  if (!files.includes(file)) return null

  const report = await readMarkdownFile(file)
  const rendered = await marked.parse(report.body, { gfm: true, breaks: false })
  const html = sanitizeHtml(String(rendered), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
    ]),
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
      th: ['align'],
      td: ['align'],
      code: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
  })

  return {
    ...report.meta,
    html,
    markdown: report.body,
  }
}
