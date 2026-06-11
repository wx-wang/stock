// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  modules: ['@pinia/nuxt'],
  ssr: false,
  runtimeConfig: {
    // 所有凭据从 server/config.ts 读取（支持 process.env 覆盖）
    // 此处保留为空占位，实际值在 server/config.ts 中定义
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
