import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', () => {
  const isDark = ref<boolean>(true)
  const activeNav = ref<string>('portfolio')
  const viewMode = ref<'table' | 'card'>('table')
  const aiPanelExpanded = ref<boolean>(false)

  function setDark(value: boolean): void {
    isDark.value = value
  }

  function toggleDark(): void {
    isDark.value = !isDark.value
  }

  function setActiveNav(nav: string): void {
    activeNav.value = nav
  }

  function setViewMode(mode: 'table' | 'card'): void {
    viewMode.value = mode
  }

  function toggleAiPanel(): void {
    aiPanelExpanded.value = !aiPanelExpanded.value
  }

  function setAiPanelExpanded(expanded: boolean): void {
    aiPanelExpanded.value = expanded
  }

  return {
    isDark,
    activeNav,
    viewMode,
    aiPanelExpanded,
    setDark,
    toggleDark,
    setActiveNav,
    setViewMode,
    toggleAiPanel,
    setAiPanelExpanded,
  }
})
