<template>
  <div class="app-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="icon">📊</div>
        <div class="text">股票看板</div>
      </div>
      <nav class="sidebar-nav">
        <NuxtLink to="/screener-overview" class="nav-item" :class="{ active: uiStore.activeNav === 'screener' }" @click="uiStore.setActiveNav('screener')">
          <span class="nav-icon">📋</span> 股票一览
        </NuxtLink>
        <NuxtLink to="/trend-analysis" class="nav-item" :class="{ active: uiStore.activeNav === 'trend' }" @click="uiStore.setActiveNav('trend')">
          <span class="nav-icon">🔭</span> 趋势分析
        </NuxtLink>
        <NuxtLink to="/sector-rotation" class="nav-item" :class="{ active: uiStore.activeNav === 'sector' }" @click="uiStore.setActiveNav('sector')">
          <span class="nav-icon">🔄</span> 行业轮动
        </NuxtLink>
        <NuxtLink to="/industry-reports" class="nav-item" :class="{ active: uiStore.activeNav === 'industry-reports' }" @click="uiStore.setActiveNav('industry-reports')">
          <span class="nav-icon">📚</span> 行业报告
        </NuxtLink>
        <NuxtLink to="/daily-analysis" class="nav-item" :class="{ active: uiStore.activeNav === 'daily-analysis' }" @click="uiStore.setActiveNav('daily-analysis')">
          <span class="nav-icon">🗓️</span> 每日分析
        </NuxtLink>
        <NuxtLink to="/market" class="nav-item" :class="{ active: uiStore.activeNav === 'market' }" @click="uiStore.setActiveNav('market')">
          <span class="nav-icon">🌍</span> 大盘分析
        </NuxtLink>
        <NuxtLink to="/broker-golden" class="nav-item" :class="{ active: uiStore.activeNav === 'broker-golden' }" @click="uiStore.setActiveNav('broker-golden')">
          <span class="nav-icon">🏦</span> 券商金股
        </NuxtLink>
      </nav>
      <div class="sidebar-footer">
        <div class="theme-toggle" @click="toggleTheme()">
          <span>{{ isDark ? '☀️' : '🌙' }}</span>
          <span>{{ isDark ? '浅色模式' : '深色模式' }}</span>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="main-content">
      <header class="topbar">
        <div class="topbar-title">{{ pageTitle }}</div>
        <div class="topbar-actions">
          <div class="topbar-time">
            <span class="dot"></span>
            <span v-if="lastUpdate">数据更新: {{ lastUpdate }}</span>
            <span v-else>等待数据加载...</span>
          </div>
          <button class="btn-refresh" @click="handleRefresh">
            <span class="refresh-icon">🔄</span> 刷新
          </button>
        </div>
      </header>
      <div class="page-content">
        <NuxtPage />
      </div>
    </div>

    <!-- Bottom Tab Bar (mobile ≤768px) -->
    <nav class="bottom-tabs">
      <NuxtLink to="/screener-overview" class="tab-item" :class="{ active: uiStore.activeNav === 'screener' }" @click="uiStore.setActiveNav('screener')">
        <span class="tab-icon">📋</span>
        <span class="tab-label">一览</span>
      </NuxtLink>
      <NuxtLink to="/trend-analysis" class="tab-item" :class="{ active: uiStore.activeNav === 'trend' }" @click="uiStore.setActiveNav('trend')">
        <span class="tab-icon">🔭</span>
        <span class="tab-label">趋势</span>
      </NuxtLink>
      <NuxtLink to="/sector-rotation" class="tab-item" :class="{ active: uiStore.activeNav === 'sector' }" @click="uiStore.setActiveNav('sector')">
        <span class="tab-icon">🔄</span>
        <span class="tab-label">行业</span>
      </NuxtLink>
      <NuxtLink to="/industry-reports" class="tab-item" :class="{ active: uiStore.activeNav === 'industry-reports' }" @click="uiStore.setActiveNav('industry-reports')">
        <span class="tab-icon">📚</span>
        <span class="tab-label">报告</span>
      </NuxtLink>
      <NuxtLink to="/daily-analysis" class="tab-item" :class="{ active: uiStore.activeNav === 'daily-analysis' }" @click="uiStore.setActiveNav('daily-analysis')">
        <span class="tab-icon">🗓️</span>
        <span class="tab-label">每日</span>
      </NuxtLink>
      <NuxtLink to="/market" class="tab-item" :class="{ active: uiStore.activeNav === 'market' }" @click="uiStore.setActiveNav('market')">
        <span class="tab-icon">🌍</span>
        <span class="tab-label">大盘</span>
      </NuxtLink>
      <NuxtLink to="/broker-golden" class="tab-item" :class="{ active: uiStore.activeNav === 'broker-golden' }" @click="uiStore.setActiveNav('broker-golden')">
        <span class="tab-icon">🏦</span>
        <span class="tab-label">金股</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '~/stores/ui'
import { useTheme } from '~/composables/useTheme'

const uiStore = useUiStore()
const { isDark, toggleTheme } = useTheme()

const pageTitle = computed(() => {
  const titles: Record<string, string> = {
    screener: '股票一览表',
    trend: '趋势分析',
    sector: '行业轮动',
    'industry-reports': '行业报告',
    'daily-analysis': '每日分析',
    market: '大盘分析',
    'broker-golden': '券商金股',
  }
  return titles[uiStore.activeNav] || '股票看板'
})

const lastUpdate = ref<string | null>(null)

async function handleRefresh() {
  lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  window.location.reload()
}

onMounted(() => {
  lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
})
</script>
