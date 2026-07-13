// https://nuxt.com/docs/api/configuration/nuxt-config
const devPort = Number(process.env.NUXT_DEV_PORT || process.env.PORT || 3000)
const devHost = process.env.NUXT_DEV_HOST || process.env.HOST || '127.0.0.1'

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  modules: ['@pinia/nuxt'],
  ssr: false,
  devServer: {
    port: Number.isFinite(devPort) ? devPort : 3000,
    host: devHost,
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
