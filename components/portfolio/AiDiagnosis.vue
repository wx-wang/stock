<template>
  <div class="card">
    <div class="card-header">
      <div class="card-title"><span class="dot-indicator" style="background:linear-gradient(135deg,#3370FF,#6B5BFF)"></span>AI 持仓诊断</div>
      <button class="btn btn-primary btn-sm" @click="$emit('analyze')" :disabled="loading">
        {{ loading ? '⏳ 分析中...' : '🤖 开始诊断' }}
      </button>
    </div>

    <div v-if="loading" style="padding:20px 0;">
      <div class="skeleton" style="height:80px;margin-bottom:12px;"></div>
      <div class="skeleton" style="height:80px;margin-bottom:12px;"></div>
      <div class="skeleton" style="height:80px;"></div>
    </div>

    <div v-else-if="!result" class="state-message">
      <div class="icon">🤖</div>
      <div class="text">点击按钮，让 AI 帮你诊断持仓组合</div>
    </div>

    <div v-else class="ai-diagnosis-grid">
      <div class="ai-card warning">
        <div class="ai-card-header"><span class="ai-icon">🎯</span>集中度风险</div>
        <div class="ai-card-body">{{ result.concentration }}</div>
      </div>
      <div class="ai-card danger">
        <div class="ai-card-header"><span class="ai-icon">🔗</span>相关性风险</div>
        <div class="ai-card-body">{{ result.correlation }}</div>
      </div>
      <div class="ai-card info">
        <div class="ai-card-header"><span class="ai-icon">📊</span>估值水平</div>
        <div class="ai-card-body">{{ result.valuation }}</div>
      </div>
      <div class="ai-card success">
        <div class="ai-card-header"><span class="ai-icon">💡</span>优化建议</div>
        <div class="ai-card-body">{{ result.suggestions }}</div>
      </div>
      <div class="ai-card" style="grid-column: 1 / -1;">
        <div class="ai-card-header"><span class="ai-icon">⚠️</span>风险提示</div>
        <div class="ai-card-body">{{ result.risk }}</div>
      </div>
    </div>
    <div v-if="result?.timestamp" style="font-size:11px;color:var(--text-muted);margin-top:12px;">
      分析基于 {{ result.timestamp }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AiDiagnosisResult } from '~/types'

defineProps<{
  result: AiDiagnosisResult | null
  loading: boolean
}>()

defineEmits<{
  analyze: []
}>()
</script>
