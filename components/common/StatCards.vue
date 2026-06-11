<template>
  <div class="stat-grid">
    <div class="stat-card" v-for="item in items" :key="item.label">
      <div class="stat-label">{{ item.label }}</div>
      <div class="stat-value" :class="item.colorClass">{{ item.value }}</div>
      <div class="stat-sub" :class="item.colorClass" v-if="item.sub">{{ item.sub }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface StatItem {
  label: string
  value: string
  sub?: string
  colorClass?: string
}

defineProps<{
  items: StatItem[]
}>()
</script>
