<template>
  <div class="timeline-section">
    <h2 class="section-title">板块热度变迁</h2>
    <div v-if="!themes.length" class="empty">加载中...</div>
    <div v-else ref="chartRef" class="tl-chart"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick, onUnmounted } from 'vue'

interface ThemeRank { code: string; name: string; ranks: Array<{ date: string; rank: number }> }

const props = defineProps<{ dates: string[]; themes: ThemeRank[] }>()
const chartRef = ref<HTMLDivElement | null>(null)
let chart: any = null

async function draw() {
  if (!chartRef.value || !props.themes.length) return
  await nextTick()
  if (chart) chart.dispose()
  try {
    const echarts = await import('echarts').then(m => m.default || m)
    chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })

    const dateLabels = props.dates.map((d: string) => d.slice(4, 6) + '/' + d.slice(6, 8))
    const palette = ['#fbbf24','#3b82f6','#ef4444','#22c55e','#a855f7','#f97316','#ec4899','#06b6d4']

    const series = props.themes.map((t, i) => ({
      name: t.name, type: 'line',
      data: dateLabels.map((dl, j) => {
        const r = t.ranks.find((r: any) => r.date === props.dates[j])
        return r ? r.rank : null
      }),
      lineStyle: { color: palette[i % palette.length], width: 2 },
      symbol: 'circle', symbolSize: 4,
    }))

    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#8b8fa3', fontSize: 10 }, itemWidth: 12, itemHeight: 3 },
      grid: { top: 12, right: 20, bottom: 36, left: 44 },
      xAxis: {
        type: 'category', data: dateLabels,
        axisLabel: { color: '#6b7280', fontSize: 10, interval: 2 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      yAxis: {
        type: 'value', inverse: true, min: 1, max: 10,
        axisLabel: { color: '#6b7280', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      },
      series,
    }, true)
  } catch (e: any) {
    console.error('[ThemeTimeline] err:', e.message)
  }
}

onMounted(() => { setTimeout(draw, 200) })
watch(() => props.themes, () => { nextTick(draw) }, { deep: true })
onUnmounted(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.timeline-section { margin-bottom: 24px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
.empty { font-size: 12px; color: var(--text-secondary); padding: 20px 0; text-align: center; }
.tl-chart { width: 100%; height: 340px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
</style>
