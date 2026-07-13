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
.fg-body { display: flex; gap: 24px; align-items: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 20px; box-shadow: var(--shadow-card); }

.fg-gauge { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }
.gauge-track {
  width: 200px; height: 20px; border-radius: 10px;
  background: linear-gradient(90deg, #C94B3D, #D98245, #B8872D, #7E9B68, #2D8B6F);
  position: relative; margin-bottom: 8px;
}
.gauge-thumb {
  position: absolute; top: -5px; bottom: -5px;
  width: 6px; background: #FFF9EF; border-radius: 3px;
  left: calc(var(--pct, 50) * 1%);
  transform: translateX(-50%);
  box-shadow: 0 0 0 1px rgba(43,36,28,0.18), 0 2px 8px rgba(91,70,42,0.22);
}
.gauge-inner { text-align: center; }
.gauge-value { font-size: 36px; font-weight: 800; color: var(--text-primary); line-height: 1; }
.gauge-label { font-size: 13px; font-weight: 600; margin-top: 4px; }
.lvl-extreme_fear { color: var(--color-up); }
.lvl-fear { color: #D98245; }
.lvl-neutral { color: var(--color-warning); }
.lvl-greed { color: #7E9B68; }
.lvl-extreme_greed { color: var(--color-down); }

.fg-bars { flex: 1; }
.fg-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.fg-bar-row:last-child { margin-bottom: 0; }
.bar-label { width: 72px; font-size: 11px; color: var(--text-secondary); text-align: right; flex-shrink: 0; }
.bar-track { flex: 1; height: 8px; background: rgba(216,205,187,0.5); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, #D98245, #2D8B6F); border-radius: 4px; transition: width .3s; }
.bar-val { width: 28px; font-size: 11px; color: var(--text-muted); text-align: left; }

@media (max-width: 600px) { .fg-body { flex-direction: column; } }
</style>
