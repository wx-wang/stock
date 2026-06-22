// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  modules: ['@pinia/nuxt'],
  ssr: false,
  devServer: {
    port: 80,
    host: '0.0.0.0',
  },
  runtimeConfig: {
    tushareToken: '',
    tushareUrl: '',
    deepseekApiKey: '',
    public: {}
  },
  css: ['~/assets/styles/main.css'],
  vite: {
    server: {
      allowedHosts: ['wx-wang.top', '.wx-wang.top'],
    },
  },
  app: {
    head: {
      title: '股票分析看板',
      meta: [{ charset: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }]
    }
  }
})
