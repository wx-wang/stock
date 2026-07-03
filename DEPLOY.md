# 部署与运维手册

> 每次部署命令、服务器配置、环境变量等，都在此记录。操作前查阅，避免踩坑。

---

## 一、部署流程

### Mac（本地开发 → 推送）

```bash
cd ~/stock-dashboard && git push
```

### 服务器（拉取 + 重启）

```bash
cd /home/stock && git pull origin main && pm2 restart stock
```

### 首次部署（服务器进程不存在时）

```bash
cd /home/stock
pm2 start "npx nuxt dev" --name stock
pm2 save
```

---

## 二、服务器信息

| 项目 | 值 |
|---|---|
| 服务器 | `root@VM-12-5-ubuntu` |
| 项目路径 | `/home/stock` |
| 域名 | `http://wx-wang.top` |
| 进程管理 | pm2 (`pm2 status` / `pm2 logs stock`) |
| 端口 | nuxt.config.ts 写死 80，nginx 反代到 Nuxt |
| 数据缓存 | `/home/stock/persist/` |

---

## 三、常用运维命令

```bash
# 看状态
pm2 status

# 看最近日志
pm2 logs stock --lines 20 --nostream

# tail 实时日志
pm2 logs stock

# 重启
pm2 restart stock

# 停掉
pm2 stop stock

# 看端口占用
lsof -i :80

# 手动清缓存（一般不需要，版本号机制自动处理）
ls /home/stock/persist/
rm /home/stock/persist/sectors-capm-*.json      # CAPM 缓存
rm /home/stock/persist/sector-picks-*.json      # 个股推荐缓存
rm /home/stock/persist/broker-golden.json       # 金股缓存
rm /home/stock/persist/idx-factor-cache.json    # 拥挤度缓存
rm /home/stock/persist/market-crowding.json     # 大盘拥挤度缓存

# 测试 API 是否正常
curl -s http://127.0.0.1:80/api/sectors/capm?days=60 | head -20
curl -s http://127.0.0.1:80/api/sectors/capm?days=60 | python3 -m json.tool | head -30

# 强制重建 CAPM
curl -s "http://127.0.0.1:80/api/sectors/capm?days=60&force=true" | head -5

# 测试个股推荐
curl -s "http://127.0.0.1:80/api/stocks/sector-picks?days=60&force=true" | python3 -m json.tool | head -30
```

---

## 四、缓存文件清单

| 文件 | 来源 | 更新机制 |
|---|---|---|
| `sectors-capm-d60-000300_SH-v5.json` | /api/sectors/capm | 每天首次访问自动重建 |
| `sector-picks-d60-Q1_Q2.json` | /api/stocks/sector-picks | CAPM 缓存比它新时自动重建 + 刷新按钮走 force |
| `broker-golden.json` | /api/broker-golden | 自愈式增量：自动检测新月份并追加 |
| `idx-factor-cache.json` | CAPM computeCrowding | 增量缓存，只补新增交易日 |
| `market-crowding.json` | /api/market/crowding | 30 分钟 TTL |
| `screener-overview.json` | /api/screener/overview | 访问筛选页面时构建 |

---

## 五、常见问题

### git pull 报 `dubious ownership`

```bash
git config --global --add safe.directory /home/stock
```

### git pull 报 HTTPS 连接失败（墙）

改用 SSH：
```bash
git remote remove origin
git remote add origin git@github.com:wx-wang/stock.git
```

### Nuxt 端口不对（跑在 3001 而不是 80）

nuxt.config.ts 里 `devServer.port` 已写死 80。如果还不对，检查是否有其他进程占 80：
```bash
lsof -i :80
kill <PID>
pm2 restart stock
```

### pm2 报 `Process stock not found`

```bash
cd /home/stock && pm2 start "npx nuxt dev" --name stock && pm2 save
```
