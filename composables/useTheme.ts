export function useTheme() {
  const THEME_KEY = 'stock-dashboard-theme'

  const isDark = ref<boolean>(true)

  // Initialize from localStorage
  function loadTheme(): void {
    try {
      const stored = localStorage.getItem(THEME_KEY)
      if (stored !== null) {
        isDark.value = stored === 'dark'
      }
    } catch {
      // keep default
    }
  }

  // Apply theme class to document
  function applyTheme(): void {
    if (isDark.value) {
      document.documentElement.classList.remove('light-theme')
    } else {
      document.documentElement.classList.add('light-theme')
    }
  }

  // Save preference
  function persistTheme(): void {
    try {
      localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light')
    } catch {
      // silently fail
    }
  }

  function toggleTheme(): void {
    isDark.value = !isDark.value
    applyTheme()
    persistTheme()
  }

  // Initialize on creation
  loadTheme()

  // Apply theme after DOM is ready
  if (typeof document !== 'undefined') {
    applyTheme()
  } else {
    onMounted(() => {
      applyTheme()
    })
  }

  return {
    isDark,
    toggleTheme,
  }
}
