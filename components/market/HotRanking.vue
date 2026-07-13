<template>
  <div class="hot-section">
    <h2 class="section-title">热门板块</h2>
    <div class="hot-grid">
      <div class="hot-col">
        <h3 class="col-title">🏭 行业 Top 10</h3>
        <div v-if="industries.length === 0" class="empty">加载中...</div>
        <div v-for="(item, i) in industries" :key="item.code" class="hot-row">
          <span class="hot-rank" :class="rankClass(i)">{{ i + 1 }}</span>
          <span class="hot-name">{{ item.name }}</span>
          <span class="hot-pct" :class="item.pctChg > 0 ? 'up' : 'down'">{{ item.pctChg > 0 ? '+' : '' }}{{ item.pctChg.toFixed(2) }}%</span>
        </div>
      </div>
      <div class="hot-col">
        <h3 class="col-title">💡 概念 Top 10</h3>
        <div v-if="concepts.length === 0" class="empty">加载中...</div>
        <div v-for="(item, i) in concepts" :key="item.code" class="hot-row">
          <span class="hot-rank" :class="rankClass(i)">{{ i + 1 }}</span>
          <span class="hot-name">{{ item.name }}</span>
          <span class="hot-pct" :class="item.pctChg > 0 ? 'up' : 'down'">{{ item.pctChg > 0 ? '+' : '' }}{{ item.pctChg.toFixed(2) }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface SItem { code: string; name: string; pctChg: number; close: number }
defineProps<{ industries: SItem[]; concepts: SItem[] }>()
function rankClass(i: number) { return i < 3 ? 'top3' : '' }
</script>

<style scoped>
.hot-section { margin-bottom: 24px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
.hot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.hot-col { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; box-shadow: var(--shadow-card); }
.col-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px; }
.hot-row { display: flex; align-items: center; padding: 5px 0; border-bottom: 1px solid rgba(216,205,187,0.5); }
.hot-row:last-child { border-bottom: none; }
.hot-rank { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 6px; font-size: 12px; font-weight: 700; color: var(--text-muted); background: rgba(184,135,45,0.10); flex-shrink: 0; }
.hot-rank.top3 { background: rgba(184,135,45,0.18); color: var(--color-warning); }
.hot-name { flex: 1; margin-left: 10px; font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hot-pct { font-size: 13px; font-weight: 600; flex-shrink: 0; }
.hot-pct.up { color: var(--color-up); }
.hot-pct.down { color: var(--color-down); }
.empty { font-size: 12px; color: var(--text-secondary); padding: 20px 0; text-align: center; }

@media (max-width: 600px) { .hot-grid { grid-template-columns: 1fr; } }
</style>
