<template>
  <div class="timeline-section">
    <h2 class="section-title">板块热度变迁</h2>
    <div v-if="!rows.length" class="empty">加载中...</div>
    <div v-else class="tl-table-wrap">
      <table class="tl-table">
        <thead>
          <tr>
            <th class="th-date">日期</th>
            <th class="th-rank">#1</th>
            <th class="th-rank">#2</th>
            <th class="th-rank">#3</th>
            <th class="th-rank">#4</th>
            <th class="th-rank">#5</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="row.date" :class="{ today: i === rows.length - 1 }">
            <td class="td-date">{{ fmtDate(row.date) }}</td>
            <td v-for="j in 5" :key="j" class="td-item" :title="row.top[j-1]?.name || ''">
              <template v-if="row.top[j-1]">
                <span class="item-name">{{ row.top[j-1].name }}</span>
                <span class="item-pct" :class="row.top[j-1].pctChg > 0 ? 'up' : 'down'">
                  {{ row.top[j-1].pctChg > 0 ? '+' : '' }}{{ row.top[j-1].pctChg.toFixed(1) }}%
                </span>
              </template>
              <span v-else class="item-none">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface RankItem { code: string; name: string; pctChg: number; rank: number }

const props = defineProps<{
  dates: string[]
  themes: Array<{ code: string; name: string; ranks: Array<{ date: string; rank: number }> }>
  hotItems?: Array<{ date: string; top: RankItem[] }>
}>()

// 如果有 hotItems 直接渲染，否则从 themes 反推
const rows = computed(() => {
  if (props.hotItems?.length) return props.hotItems

  const map = new Map<string, RankItem[]>()
  for (const t of props.themes) {
    for (const r of t.ranks) {
      if (!map.has(r.date)) map.set(r.date, [])
      map.get(r.date)!.push({ code: t.code, name: t.name, pctChg: 0, rank: r.rank })
    }
  }
  return [...map.entries()]
    .map(([date, items]) => {
      items.sort((a, b) => a.rank - b.rank)
      return { date, top: items.slice(0, 5) }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-15)
})

function fmtDate(d: string) {
  return d.slice(4, 6) + '/' + d.slice(6, 8)
}
</script>

<style scoped>
.timeline-section { margin-bottom: 24px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
.empty { font-size: 12px; color: var(--text-secondary); padding: 20px 0; text-align: center; }
.tl-table-wrap { overflow-x: auto; }
.tl-table { width: 100%; border-collapse: collapse; font-size: 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; display: block; box-shadow: 0 10px 28px var(--color-paper-shadow); }
.tl-table thead { display: table; width: 100%; table-layout: fixed; }
.tl-table tbody { display: table; width: 100%; table-layout: fixed; max-height: 560px; overflow-y: auto; display: block; }
.tl-table tbody tr { display: table; width: 100%; table-layout: fixed; }
.tl-table th { padding: 10px 6px; text-align: center; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border); font-size: 11px; }
.th-date { width: 9%; }
.th-rank { width: 18.2%; }
.td-date { padding: 8px 4px; text-align: center; color: var(--text-muted); font-size: 11px; border-bottom: 1px solid rgba(216,205,187,0.5); white-space: nowrap; }
.td-item { padding: 6px 4px; text-align: center; border-bottom: 1px solid rgba(216,205,187,0.5); }
.item-name { display: block; font-size: 12px; color: var(--text-primary); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; margin: 0 auto; }
.item-pct { font-size: 10px; }
.item-pct.up { color: var(--color-up); }
.item-pct.down { color: var(--color-down); }
.item-none { color: var(--text-muted); }
.today { background: rgba(69,107,143,0.07); }
.today .td-date { color: var(--color-accent); font-weight: 600; }
</style>
