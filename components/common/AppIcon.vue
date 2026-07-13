<template>
  <svg class="app-icon" viewBox="0 0 24 24" aria-hidden="true">
    <template v-if="name === 'logo'">
      <path d="M4 18V9l4-3 4 3v9" />
      <path d="M3 18h18" />
      <path d="M14 18V6h5v12" />
      <path d="M7 18v-5h3v5" />
    </template>
    <template v-else-if="name === 'list'">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 8h1.5M12 8h4M8 12h1.5M12 12h4M8 16h1.5M12 16h4" />
    </template>
    <template v-else-if="name === 'trend'">
      <path d="M4 18h16" />
      <path d="M5 16l4-5 3 3 6-8" />
      <path d="M15 6h3v3" />
      <path d="M6 6v12" />
    </template>
    <template v-else-if="name === 'sector'">
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 3v9h9" />
      <path d="M12 12l6.5 6.5" />
    </template>
    <template v-else-if="name === 'report'">
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21z" />
      <path d="M5 5.5V21" />
      <path d="M9 7h7M9 11h7M9 15h4" />
    </template>
    <template v-else-if="name === 'daily'">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 9h16" />
      <path d="M8 13h2M12 13h2M16 13h1M8 16h2M12 16h2" />
    </template>
    <template v-else-if="name === 'market'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5" />
      <path d="M12 3.5C9.7 5.9 8.6 8.7 8.6 12s1.1 6.1 3.4 8.5" />
    </template>
    <template v-else-if="name === 'bank'">
      <path d="M4 10h16" />
      <path d="M6 10v8M10 10v8M14 10v8M18 10v8" />
      <path d="M3 20h18M5 7l7-4 7 4z" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18 10a6.5 6.5 0 0 0-11-3l-3 3" />
      <path d="M6 14a6.5 6.5 0 0 0 11 3l3-3" />
    </template>
    <template v-else-if="name === 'theme'">
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
      <circle cx="12" cy="12" r="4" />
      <path d="M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="8" />
    </template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<style scoped>
.app-icon {
  width: 1em;
  height: 1em;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
