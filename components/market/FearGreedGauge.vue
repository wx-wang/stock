<template>
  <div class="fg-section">
    <h2 class="section-title">市场情绪</h2>
    <div v-if="!data || !data.success" class="empty">加载中...</div>
    <div v-else class="fg-body">
      <div class="fg-gauge">
        <div class="gauge-track" :style="{ '--pct': data.index }">
          <div class="gauge-thumb"></div>
        </div>
        <div class="gauge-inner">
          <div class="gauge-value">{{ data.index }}</div>
          <div class="gauge-label" :class="`lvl-${data.level}`">{{ data.label }}</div>
        </div>
      </div>
      <div class="fg-bars">
        <div v-for="(v, k) in data.components" :key="k" class="fg-bar-row">
          <span class="bar-label">{{ labelMap[k as string] || k }}</span>
          <div class="bar-track"><div class="bar-fill" :style="{ width: (v || 0) + '%' }"></div></div>
          <span class="bar-val">{{ v || 0 }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface FGData { success: boolean; index: number; label: string; level: string; components: Record<string,number> }
defineProps<{ data: FGData | null }>()
const labelMap: Record<string,string> = {
  breadth: '市场广度',
  profitEffect: '赚钱效应',
  riskAppetite: '风险偏好',
  fundFlow: '资金行为',
  crowding: '拥挤修正',
  limitRatio: '涨停/跌停',
  hs300Chg: '沪深300',
  volume: '成交额',
}
</script>

<style scoped>
.fg-section { margin-bottom: 24px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
.empty { font-size: 12px; color: var(--text-secondary); padding: 20px 0; text-align: center; }
.fg-body { display: flex; gap: 24px; align-items: center; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }

.fg-gauge { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }
.gauge-track {
  width: 200px; height: 20px; border-radius: 10px;
  background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #10b981);
  position: relative; margin-bottom: 8px;
}
.gauge-thumb {
  position: absolute; top: -5px; bottom: -5px;
  width: 6px; background: #fff; border-radius: 3px;
  left: calc(var(--pct, 50) * 1%);
  transform: translateX(-50%);
  box-shadow: 0 0 6px rgba(255,255,255,0.4);
}
.gauge-inner { text-align: center; }
.gauge-value { font-size: 36px; font-weight: 800; color: var(--text-primary); line-height: 1; }
.gauge-label { font-size: 13px; font-weight: 600; margin-top: 4px; }
.lvl-extreme_fear { color: #ef4444; }
.lvl-fear { color: #f97316; }
.lvl-neutral { color: #eab308; }
.lvl-greed { color: #22c55e; }
.lvl-extreme_greed { color: #10b981; }

.fg-bars { flex: 1; }
.fg-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.fg-bar-row:last-child { margin-bottom: 0; }
.bar-label { width: 72px; font-size: 11px; color: var(--text-secondary); text-align: right; flex-shrink: 0; }
.bar-track { flex: 1; height: 8px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, #f97316, #22c55e); border-radius: 4px; transition: width .3s; }
.bar-val { width: 28px; font-size: 11px; color: #6b7280; text-align: left; }

@media (max-width: 600px) { .fg-body { flex-direction: column; } }
</style>
