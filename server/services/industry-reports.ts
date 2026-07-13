import { promises as fs } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

const REPORT_DIR = path.resolve(process.cwd(), 'content/industry-reports')

export interface IndustryReportMeta {
  slug: string
  title: string
  industry: string
  date: string
  summary: string
  tags: string[]
  wordCount: number
}

export interface IndustryReportDetail extends IndustryReportMeta {
  html: string
  markdown: string
}

function stripExt(file: string): string {
  return file.replace(/\.md$/i, '')
}

function normalizeDate(input: unknown, content: string): string {
  const fromMeta = input ? String(input).trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromMeta)) return fromMeta

  const matched = content.match(/生成日期[：:]\s*(\d{4}[-/]\d{2}[-/]\d{2})/)
    || content.match(/(\d{4}[-/]\d{2}[-/]\d{2})/)
  return matched ? matched[1].replace(/\//g, '-') : ''
}

function titleFromContent(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim()
  return fallback
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, s => s.toUpperCase())
}

function inferIndustry(title: string, input: unknown): string {
  if (input) return String(input)
  return title
    .replace(/产业地图(深度)?分析报告/g, '')
    .replace(/行业深度报告/g, '')
    .replace(/分析报告/g, '')
    .replace(/报告/g, '')
    .trim() || '行业研究'
}

function normalizeTags(input: unknown, title: string): string[] {
  if (Array.isArray(input)) return input.map(String).filter(Boolean).slice(0, 8)
  if (typeof input === 'string') return input.split(/[,，、\s]+/).filter(Boolean).slice(0, 8)

  const tags: string[] = []
  if (/算力|昇腾|AI|服务器|芯片/.test(title)) tags.push('AI算力')
  if (/CXO|CRO|CDMO|医药|药/.test(title)) tags.push('医药')
  if (/华为|昇腾/.test(title)) tags.push('华为链')
  if (/国产/.test(title)) tags.push('国产替代')
  return tags.length ? tags : ['产业地图']
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
    .find(line => line.length >= 24)

  return plain ? plain.slice(0, 140) : '暂无摘要'
}

function countWords(content: string): number {
  const compact = content.replace(/\s/g, '')
  return compact.length
}

async function readMarkdownFile(file: string): Promise<{ meta: IndustryReportMeta; body: string }> {
  const slug = stripExt(file)
  const raw = await fs.readFile(path.join(REPORT_DIR, file), 'utf-8')
  const parsed = matter(raw)
  const content = parsed.content.trim()
  const title = parsed.data.title ? String(parsed.data.title) : titleFromContent(content, slug)

  return {
    body: content,
    meta: {
      slug,
      title,
      industry: inferIndustry(title, parsed.data.industry),
      date: normalizeDate(parsed.data.date, content),
      summary: summarize(content, parsed.data.summary),
      tags: normalizeTags(parsed.data.tags, title),
      wordCount: countWords(content),
    },
  }
}

export async function listIndustryReports(): Promise<IndustryReportMeta[]> {
  const files = await fs.readdir(REPORT_DIR).catch(() => [])
  const markdownFiles = files.filter(file => file.endsWith('.md')).sort()
  const reports = await Promise.all(markdownFiles.map(readMarkdownFile))

  return reports
    .map(report => report.meta)
    .sort((a, b) => {
      const byDate = (b.date || '').localeCompare(a.date || '')
      return byDate || a.title.localeCompare(b.title, 'zh-CN')
    })
}

export async function getIndustryReport(slug: string): Promise<IndustryReportDetail | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return null

  const file = `${slug}.md`
  const files = await fs.readdir(REPORT_DIR).catch(() => [])
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
