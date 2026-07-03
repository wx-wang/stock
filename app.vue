<template>
  <div class="app-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="icon">📊</div>
        <div class="text">股票看板</div>
      </div>
      <nav class="sidebar-nav">
        <NuxtLink to="/" class="nav-item" :class="{ active: uiStore.activeNav === 'portfolio' }" @click="uiStore.setActiveNav('portfolio')">
          <span class="nav-icon">💼</span> 持仓概览
        </NuxtLink>
        <NuxtLink to="/sector-rotation" class="nav-item" :class="{ active: uiStore.activeNav === 'sector' }" @click="uiStore.setActiveNav('sector')">
          <span class="nav-icon">🔄</span> 行业轮动
        </NuxtLink>
        <NuxtLink to="/rps" class="nav-item" :class="{ active: uiStore.activeNav === 'rps' }" @click="uiStore.setActiveNav('rps')">
          <span class="nav-icon">📈</span> 行业RPS
          <span class="nav-badge">开发中</span>
        </NuxtLink>
        <NuxtLink to="/market" class="nav-item" :class="{ active: uiStore.activeNav === 'market' }" @click="uiStore.setActiveNav('market')">
          <span class="nav-icon">🌍</span> 大盘分析
          <span class="nav-badge">开发中</span>
        </NuxtLink>
        <a class="nav-item">
          <span class="nav-icon">🔍</span> 个股分析
          <span class="nav-badge">开发中</span>
        </a>
        <NuxtLink to="/watchlist" class="nav-item" :class="{ active: uiStore.activeNav === 'watchlist' }" @click="uiStore.setActiveNav('watchlist')">
          <span class="nav-icon">⭐</span> 自选股
        </NuxtLink>
        <NuxtLink to="/broker-golden" class="nav-item" :class="{ active: uiStore.activeNav === 'broker-golden' }" @click="uiStore.setActiveNav('broker-golden')">
          <span class="nav-icon">🏦</span> 券商金股
        </NuxtLink>
        <NuxtLink to="/trend-analysis" class="nav-item" :class="{ active: uiStore.activeNav === 'trend' }" @click="uiStore.setActiveNav('trend')">
          <span class="nav-icon">🔭</span> 趋势分析
        </NuxtLink>
        <NuxtLink to="/screener-overview" class="nav-item" :class="{ active: uiStore.activeNav === 'screener' }" @click="uiStore.setActiveNav('screener')">
          <span class="nav-icon">📋</span> 股票一览
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
          <button class="btn-refresh" :class="{ spinning: portfolioStore.loading }" @click="handleRefresh" :disabled="portfolioStore.loading">
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
      <NuxtLink to="/watchlist" class="tab-item" :class="{ active: uiStore.activeNav === 'watchlist' }" @click="uiStore.setActiveNav('watchlist')">
        <span class="tab-icon">⭐</span>
        <span class="tab-label">自选</span>
      </NuxtLink>
      <NuxtLink to="/" class="tab-item" :class="{ active: uiStore.activeNav === 'portfolio' }" @click="uiStore.setActiveNav('portfolio')">
        <span class="tab-icon">💼</span>
        <span class="tab-label">持仓</span>
      </NuxtLink>
      <NuxtLink to="/sector-rotation" class="tab-item" :class="{ active: uiStore.activeNav === 'sector' }" @click="uiStore.setActiveNav('sector')">
        <span class="tab-icon">🔄</span>
        <span class="tab-label">行业</span>
      </NuxtLink>
      <NuxtLink to="/broker-golden" class="tab-item" :class="{ active: uiStore.activeNav === 'broker-golden' }" @click="uiStore.setActiveNav('broker-golden')">
        <span class="tab-icon">🏦</span>
        <span class="tab-label">金股</span>
      </NuxtLink>
      <NuxtLink to="/trend-analysis" class="tab-item" :class="{ active: uiStore.activeNav === 'trend' }" @click="uiStore.setActiveNav('trend')">
        <span class="tab-icon">🔭</span>
        <span class="tab-label">趋势</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { usePortfolioStore } from '~/stores/portfolio'
import { useUiStore } from '~/stores/ui'
import { useTheme } from '~/composables/useTheme'

const portfolioStore = usePortfolioStore()
const uiStore = useUiStore()
const { isDark, toggleTheme } = useTheme()

const pageTitle = computed(() => {
  const titles: Record<string, string> = { portfolio: '持仓概览', sector: '行业轮动', rps: '行业RPS', market: '大盘分析', watchlist: '自选股分析', 'broker-golden': '券商金股', screener: '股票一览表', trend: '趋势分析' }
  return titles[uiStore.activeNav] || '股票看板'
})

const lastUpdate = ref<string | null>(null)

async function handleRefresh() {
  await portfolioStore.refreshAll()
  lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(async () => {
  if (portfolioStore.holdings.length > 0) {
    await handleRefresh()
  }
})
</script>
