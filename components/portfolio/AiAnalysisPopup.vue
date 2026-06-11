<template>
  <Teleport to="body">
    <div class="ai-overlay" @click.self="$emit('close')">
      <div class="ai-container">
        <div class="ai-header">
          <h3 class="ai-title">🤖 AI 分析 — {{ stockName }} <span class="ai-code">{{ tsCode }}</span></h3>
          <button class="ai-close" @click="$emit('close')">✕</button>
        </div>

        <!-- 加载状态 -->
        <div v-if="aiLoading" class="ai-status">⏳ 正在调用 DeepSeek 大模型分析，请稍候…</div>

        <!-- 错误 -->
        <div v-if="aiError" class="ai-status ai-error">⚠️ {{ aiError }}</div>

        <!-- 结果 -->
        <div v-if="aiResult && !aiLoading" class="ai-body" v-html="aiHtml"></div>

        <!-- 无结果且未加载 -->
        <div v-if="!aiResult && !aiLoading && !aiError" class="ai-status">
          <p style="margin-bottom:16px;color:#888;">暂无分析结果，点击下方按钮开始分析</p>
        </div>

        <!-- 操作栏 -->
        <div class="ai-footer">
          <span v-if="aiDate" class="ai-date">📅 上次分析: {{ aiDate }}</span>
          <button
            class="btn-ai-analyze"
            :disabled="aiLoading"
            @click="runAnalysis()"
          >
            {{ aiLoading ? '⏳ 分析中…' : aiResult ? '🔄 重新分析' : '🚀 开始分析' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ tsCode: string; stockName: string; shares?: number; cost?: number }>()

const aiLoading = ref(false)
const aiError = ref<string | null>(null)
const aiResult = ref<string | null>(null)
const aiDate = ref<string | null>(null)
const aiSummary = ref('')

const emit = defineEmits<{ close: []; summary: [tsCode: string, summary: string] }>()

function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const result: string[] = []
  let i = 0
  let tableRows: string[][] = []

  function flushTable() {
    if (tableRows.length === 0) return
    const header = tableRows[0]
    const body = tableRows.length > 2 ? tableRows.slice(2) : tableRows.slice(1)
    let html = '<table class="ai-table"><thead><tr>'
    for (const cell of header) {
      html += `<th>${cell.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</th>`
    }
    html += '</tr></thead><tbody>'
    for (const row of body) {
      html += '<tr>'
      for (const cell of row) {
        html += `<td>${cell.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    result.push(html)
    tableRows = []
  }

  function isTableRow(line: string) {
    const t = line.trim()
    return t.startsWith('|') && t.endsWith('|') && t.includes('|', 1)
  }

  function isSeparator(line: string) {
    return /^\|[\s\-:|]+\|$/.test(line.trim())
  }

  for (i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    // Table row
    if (isTableRow(t)) {
      if (isSeparator(t)) {
        // separator row, skip but continue collecting
        continue
      }
      const cells = t.split('|').slice(1, -1).map(c => c.trim())
      tableRows.push(cells)
      continue
    }

    // Not a table row — flush pending table
    flushTable()

    if (!t) {
      result.push('')
      continue
    }

    // Header lines
    if (/^#### /.test(t)) {
      result.push(t.replace(/^#### (.*)/, '<h4 class="ai-h4">$1</h4>'))
    } else if (/^### /.test(t)) {
      result.push(t.replace(/^### (.*)/, '<h4 class="ai-h4">$1</h4>'))
    } else if (/^## /.test(t)) {
      result.push(t.replace(/^## (.*)/, '<h3 class="ai-h3">$1</h3>'))
    } else if (/^# /.test(t)) {
      result.push(t.replace(/^# (.*)/, '<h2 class="ai-h2">$1</h2>'))
    } else if (/^---/.test(t)) {
      result.push('<hr class="ai-hr"/>')
    } else {
      // Inline formatting for body text
      let html = t
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code class="ai-code">$1</code>')
      result.push(html)
    }
  }

  flushTable()

  // Join with <br> for single line breaks, wrap segments with <p>
  return result.map(r => {
    if (!r || r.startsWith('<')) return r
    return r
  }).join('<br/>')
}

const aiHtml = computed(() => {
  if (!aiResult.value) return ''
  return mdToHtml(aiResult.value)
})

// 页面打开时先拉缓存
async function loadCached() {
  try {
    const resp = await fetch(`/api/stocks/ai-analysis?ts_code=${props.tsCode}`)
    const json = await resp.json()
    if (json.success && json.data) {
      aiResult.value = json.data.analysis
      aiDate.value = json.data.date
      aiSummary.value = json.data.summary || ''
      emit('summary', props.tsCode, aiSummary.value)
    }
  } catch {}
}

async function runAnalysis() {
  aiLoading.value = true; aiError.value = null
  try {
    const resp = await fetch('/api/stocks/ai-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts_code: props.tsCode, name: props.stockName, shares: props.shares || 0, cost: props.cost || 0, force: true }),
    })
    const json = await resp.json()
    if (json.success) {
      aiResult.value = json.data.analysis
      aiDate.value = json.data.date
      aiSummary.value = json.data.summary || ''
      emit('summary', props.tsCode, aiSummary.value)
    } else {
      aiError.value = json.error
    }
  } catch (e: any) { aiError.value = e.message } finally { aiLoading.value = false }
}

onMounted(() => loadCached())
</script>

<style scoped>
.ai-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
  z-index: 9999; backdrop-filter: blur(2px);
}
.ai-container {
  background: var(--bg-card, #1a1a2e); border: 1px solid var(--border-color, #2a2a4a);
  border-radius: 12px; width: 750px; max-width: 95vw; max-height: 88vh;
  display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.ai-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; border-bottom: 1px solid var(--border-color, #2a2a4a); flex-shrink: 0;
}
.ai-title { font-size: 16px; font-weight: 700; margin: 0; }
.ai-code { font-size: 12px; color: var(--text-secondary, #888); font-family: monospace; margin-left: 8px; font-weight: 400; }
.ai-close { background: none; border: none; color: var(--text-secondary, #888); font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px; line-height: 1; }
.ai-close:hover { background: rgba(255,255,255,0.1); color: #fff; }

.ai-status { padding: 60px 20px; text-align: center; color: var(--text-secondary, #888); }
.ai-error { color: var(--color-down, #ef4444); }

.ai-body {
  flex: 1; overflow-y: auto; padding: 12px 24px 20px;
  font-size: 13px; line-height: 1.85; color: #ccc;
}
:deep(.ai-h3) { font-size: 16px; font-weight: 700; color: #e4e7ed; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.06); }
:deep(.ai-h2) { font-size: 18px; font-weight: 800; color: #f0f0f0; margin: 20px 0 10px; }
:deep(.ai-h4) { font-size: 14px; font-weight: 600; color: #667eea; margin: 12px 0 4px; }
:deep(.ai-p) { margin: 6px 0; }
:deep(strong) { color: #f59e0b; }
:deep(.ai-code) { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 12px; }
:deep(.ai-hr) { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 12px 0; }

:deep(.ai-table) {
  width: 100%; border-collapse: collapse; margin: 10px 0 16px;
  font-size: 12px; line-height: 1.6;
}
:deep(.ai-table th) {
  background: rgba(102,126,234,0.12); color: #ccc; font-weight: 700;
  padding: 8px 10px; text-align: left; border: 1px solid rgba(255,255,255,0.06);
  white-space: nowrap;
}
:deep(.ai-table td) {
  padding: 7px 10px; border: 1px solid rgba(255,255,255,0.04); color: #bbb;
}
:deep(.ai-table tr:hover td) { background: rgba(255,255,255,0.02); }

.ai-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px; border-top: 1px solid var(--border-color, #2a2a4a); flex-shrink: 0;
}
.ai-date { font-size: 11px; color: #666; }

.btn-ai-analyze {
  display: inline-flex; align-items: center; gap: 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff; border: none; border-radius: 6px;
  font-size: 13px; font-weight: 600; padding: 8px 20px;
  cursor: pointer; transition: opacity 0.2s;
}
.btn-ai-analyze:hover { opacity: 0.85; }
.btn-ai-analyze:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
