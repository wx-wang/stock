<template>
  <div class="theme-section">
    <h2 class="section-title">今日主线</h2>
    <div v-if="!industryTheme.length && !conceptTheme.length" class="empty">分析中...</div>
    <div class="theme-grid" v-else>
      <div class="theme-col">
        <h3 class="col-title">🏭 行业主线</h3>
        <div v-for="t in industryTheme" :key="t.code" class="theme-card">
          <div class="theme-head">
            <span class="theme-badge rank" :class="`r${t.rank}`">#{{ t.rank }}</span>
            <span class="theme-name">{{ t.name }}</span>
            <span class="theme-score">{{ t.score }}分</span>
          </div>
          <div class="theme-dims">
            <span class="dim" title="5日动量">5D:{{ t.dimensions.momentum5d }}</span>
            <span class="dim" title="20日动量">20D:{{ t.dimensions.momentum20d }}</span>
            <span class="dim" title="持续天数">持续:{{ t.dimensions.persistence }}天</span>
            <span class="dim" title="广度">广度:{{ t.dimensions.breadth }}</span>
            <span class="dim" title="量能比">量能:{{ t.dimensions.volumeRatio }}x</span>
          </div>
          <div class="theme-narrative">{{ t.narrative }}</div>
        </div>
      </div>
      <div class="theme-col">
        <h3 class="col-title">💡 概念主线</h3>
        <div v-for="t in conceptTheme" :key="t.code" class="theme-card">
          <div class="theme-head">
            <span class="theme-badge rank" :class="`r${t.rank}`">#{{ t.rank }}</span>
            <span class="theme-name">{{ t.name }}</span>
            <span class="theme-score">{{ t.score }}分</span>
          </div>
          <div class="theme-dims">
            <span class="dim">5D:{{ t.dimensions.momentum5d }}</span>
            <span class="dim">20D:{{ t.dimensions.momentum20d }}</span>
            <span class="dim">持续:{{ t.dimensions.persistence }}天</span>
            <span class="dim">广度:{{ t.dimensions.breadth }}</span>
            <span class="dim">量能:{{ t.dimensions.volumeRatio }}x</span>
          </div>
          <div class="theme-narrative">{{ t.narrative }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ThemeItem { code: string; name: string; score: number; rank: number; dimensions: Record<string,number>; narrative: string }
defineProps<{ industryTheme: ThemeItem[]; conceptTheme: ThemeItem[] }>()
</script>

<style scoped>
.theme-section { margin-bottom: 24px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
.empty { font-size: 12px; color: var(--text-secondary); padding: 20px 0; text-align: center; }
.theme-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.theme-col { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
.col-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px; }
.theme-card { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.theme-card:last-child { border-bottom: none; }
.theme-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.theme-badge.rank { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 12px; font-weight: 800; }
.theme-badge.r1 { background: rgba(251,191,36,0.2); color: #fbbf24; }
.theme-badge.r2 { background: rgba(148,163,184,0.2); color: #94a3b8; }
.theme-badge.r3 { background: rgba(180,83,9,0.2); color: #b45309; }
.theme-name { font-size: 14px; font-weight: 600; color: var(--text-primary); flex: 1; }
.theme-score { font-size: 13px; font-weight: 700; color: #f59e0b; }
.theme-dims { display: flex; gap: 8px; margin-bottom: 4px; }
.dim { font-size: 10px; color: #6b7280; background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px; }
.theme-narrative { font-size: 11px; color: var(--text-secondary); }

@media (max-width: 600px) { .theme-grid { grid-template-columns: 1fr; } }
</style>
