<template>
  <div class="card">
    <div class="card-header">
      <div class="card-title"><span class="dot-indicator"></span>行业分布</div>
    </div>
    <div v-if="data.length === 0" class="state-message">
      <div class="icon">📊</div>
      <div class="text">暂无数据</div>
    </div>
    <VChart v-else :option="chartOption" class="chart-container" autoresize />
  </div>
</template>

<script setup lang="ts">
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([PieChart, TooltipComponent, LegendComponent, CanvasRenderer])

const props = defineProps<{
  data: { name: string; value: number }[]
}>()

const chartOption = computed(() => ({
  tooltip: {
    trigger: 'item' as const,
    formatter: '{b}: {c} ({d}%)',
    backgroundColor: '#1A1D27',
    borderColor: '#2A2E39',
    textStyle: { color: '#E4E7ED', fontSize: 13 }
  },
  legend: {
    orient: 'vertical' as const,
    right: 10,
    top: 'center',
    textStyle: { color: '#8B8FA3', fontSize: 11 },
    itemWidth: 8,
    itemHeight: 8,
    itemGap: 12,
  },
  series: [{
    type: 'pie' as const,
    radius: ['45%', '75%'],
    center: ['35%', '50%'],
    avoidLabelOverlap: false,
    itemStyle: {
      borderRadius: 4,
      borderColor: '#1A1D27',
      borderWidth: 2,
    },
    label: {
      show: true,
      position: 'outside' as const,
      formatter: '{b}\n{d}%',
      color: '#8B8FA3',
      fontSize: 11,
      lineHeight: 16,
    },
    emphasis: {
      label: { show: true, fontSize: 14, fontWeight: 'bold' },
      scaleSize: 8,
    },
    data: props.data,
  }],
  color: ['#3370FF', '#22AB94', '#F0A028', '#E15241', '#6B5BFF', '#00B4D8', '#FF6B6B', '#4ECDC4', '#FFD93D', '#C084FC'],
}))
</script>
