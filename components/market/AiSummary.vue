<template>
  <div class="ai-section">
    <div class="ai-header">
      <h2 class="section-title">AI 大盘总结</h2>
      <button class="ai-refresh" :class="{ spinning }" @click="refresh" :disabled="spinning">{{ spinning ? '分析中...' : '重新分析' }}</button>
    </div>
    <div v-if="!data || !data.headline" class="empty">分析加载中...</div>
    <div v-else class="ai-body">
      <div class="ai-headline">{{ data.headline }}</div>
      <div class="ai-narrative">{{ data.narrative }}</div>
      <div class="ai-grid">
        <div class="ai-item">
          <span class="ai-item-label">📍 上涨广度</span>
          <span class="ai-item-val">{{ data.breadth }}</span>
        </div>
        <div class="ai-item">
          <span class="ai-item-label">🔗 趋势共振</span>
          <span class="ai-item-val">{{ data.trendAlignment }}</span>
        </div>
        <div class="ai-item">
          <span class="ai-item-label">💰 仓位参考</span>
          <span class="ai-item-val">{{ data.position }}</span>
        </div>
      </div>
      <div v-if="data.riskFlags?.length" class="ai-risks">
        <span class="risk-label">⚠️</span>
        <span v-for="(rf, i) in data.riskFlags" :key="i" class="risk-item">{{ rf }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface AIData { headline: string; narrative: string; breadth: string; trendAlignment: string; riskFlags: string[]; position: string }
defineProps<{ data: AIData | null }>()
const emit = defineEmits<{ refresh: [] }>()

const spinning = ref(false)
async function refresh() {
  spinning.value = true
  emit('refresh')
  setTimeout(() => { spinning.value = false }, 3000)
}
</script>

<style scoped>
.ai-section { margin-bottom: 24px; }
.ai-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.ai-refresh { padding: 6px 16px; border-radius: 6px; border: 1px solid rgba(69,107,143,0.24); background: rgba(69,107,143,0.10); color: var(--color-accent); font-size: 12px; cursor: pointer; transition: opacity .2s; }
.ai-refresh:disabled { opacity: 0.5; }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.empty { font-size: 12px; color: var(--text-secondary); padding: 20px 0; text-align: center; }
.ai-body { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 18px; box-shadow: var(--shadow-card); }
.ai-headline { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; }
.ai-narrative { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 14px; }
.ai-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.ai-item { background: rgba(184,135,45,0.07); border: 1px solid rgba(216,205,187,0.75); border-radius: 8px; padding: 10px; }
.ai-item-label { display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.ai-item-val { font-size: 12px; color: var(--text-primary); line-height: 1.4; }
.ai-risks { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.risk-label { font-size: 14px; }
.risk-item { font-size: 12px; color: var(--color-warning); background: rgba(184,135,45,0.10); padding: 4px 10px; border-radius: 6px; }

@media (max-width: 600px) { .ai-grid { grid-template-columns: 1fr; } }
</style>
