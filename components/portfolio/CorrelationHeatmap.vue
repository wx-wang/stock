<template>
  <div class="card">
    <div class="card-header">
      <div class="card-title"><span class="dot-indicator"></span>持仓相关性矩阵</div>
      <div class="correlation-legend">
        <span>-1 负相关</span>
        <div class="correlation-gradient"></div>
        <span>+1 正相关</span>
      </div>
    </div>
    <div v-if="names.length === 0" class="state-message">
      <div class="icon">🔗</div>
      <div class="text">需要至少2只持仓才能计算相关性</div>
    </div>
    <div v-else-if="loading" class="state-message">
      <div class="icon">⏳</div>
      <div class="text">正在计算相关性...</div>
    </div>
    <VChart v-else :option="chartOption" class="chart-container" autoresize />
    <!-- High correlation warnings -->
    <div v-if="highPairs.length > 0" style="margin-top:12px;">
      <div style="font-size:12px;color:var(--color-warning);margin-bottom:8px;">⚠️ 高相关组合（相关系数 > 0.7）</div>
      <div v-for="p in highPairs" :key="p.code1+p.code2" class="tag tag-up" style="margin-right:6px;margin-bottom:4px;">
        {{ p.name1 }} ↔ {{ p.name2 }}: {{ p.correlation.toFixed(2) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { HeatmapChart } from 'echarts/charts'
import { TooltipComponent, VisualMapComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([HeatmapChart, TooltipComponent, VisualMapComponent, GridComponent, CanvasRenderer])

const props = defineProps<{
  names: string[]
  matrix: number[][]
  highPairs: { code1: string; code2: string; name1: string; name2: string; correlation: number }[]
  loading?: boolean
}>()

const chartOption = computed(() => {
  const data: [number, number, number][] = []
  for (let i = 0; i < props.names.length; i++) {
    for (let j = 0; j < props.names.length; j++) {
      data.push([j, i, j < i ? (props.matrix[i]?.[j] ?? 0) : (props.matrix[j]?.[i] ?? 0)])
    }
  }

  return {
    tooltip: {
      formatter: (p: any) => `${props.names[p.value[1]]} - ${props.names[p.value[0]]}: ${p.value[2].toFixed(4)}`,
      backgroundColor: '#1A1D27',
      borderColor: '#2A2E39',
      textStyle: { color: '#E4E7ED', fontSize: 13 }
    },
    grid: { left: 110, right: 60, top: 10, bottom: 60 },
    xAxis: {
      type: 'category' as const,
      data: props.names,
      axisLabel: { rotate: 45, fontSize: 10, color: '#8B8FA3' },
      splitArea: { show: true },
      position: 'top' as const,
    },
    yAxis: {
      type: 'category' as const,
      data: props.names,
      axisLabel: { fontSize: 10, color: '#8B8FA3' },
      splitArea: { show: true },
      inverse: true,
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: true,
      orient: 'vertical' as const,
      right: 0,
      top: 'center',
      inRange: { color: ['#22AB94', '#ffffff', '#E15241'] },
      textStyle: { color: '#8B8FA3' },
    },
    series: [{
      type: 'heatmap' as const,
      data,
      label: {
        show: true,
        fontSize: 10,
        color: (p: any) => Math.abs(p.value[2]) > 0.5 ? '#fff' : '#8B8FA3',
      },
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' }
      }
    }]
  }
})
</script>
