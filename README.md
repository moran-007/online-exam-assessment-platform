# 在线答题与智能测评平台

基于 NestJS、Prisma、PostgreSQL 和 Vue 3 的在线考试平台。后端接口统一前缀为 `/api/v1`，前端开发地址默认为 `http://localhost:5173`。

## 已实现能力

- JWT Access Token + Refresh Token 登录、刷新、退出和当前用户接口。
- 可选“保持登录状态”、前后端闲置失效校验、服务端会话吊销和活动续期。
- 管理员、教师、助教、学生等角色，以及菜单、角色、权限和数据范围控制。
- 课程、班级、知识点、标签、题库、试卷、考试、批改、错题本、导出和统计分析。
- Prisma/PostgreSQL 数据模型、审计日志，以及 PostgreSQL、Redis、MinIO 本地依赖。

## 登录与会话策略

| 场景 | 默认规则 |
| --- | --- |
| Access Token | 15 分钟；临近过期且会话仍有效时自动刷新 |
| 不保持登录 | 使用 `sessionStorage`，关闭浏览器后失效，服务端最长 8 小时 |
| 保持登录 | 使用 `localStorage`，服务端最长 7 天 |
| 闲置失效 | 连续 30 分钟无有效操作后，Access Token 和 Refresh Token 均不可继续使用 |
| 有效操作 | 点击、键盘、触摸、滚动及其触发的已认证业务请求；活动上报最多每分钟一次 |
| 主动退出 | 调用服务端退出接口吊销整个登录会话，再清理浏览器中的令牌和用户信息 |

以上时长可在 `.env` 中调整：

```env
JWT_ACCESS_EXPIRES_IN=15m
JWT_SESSION_EXPIRES_IN=8h
JWT_REMEMBER_EXPIRES_IN=7d
JWT_IDLE_EXPIRES_IN=30m
```

支持 `s`、`m`、`h`、`d` 单位。生产环境必须设置长度不少于 32 位的 `JWT_ACCESS_SECRET` 和 `JWT_REFRESH_SECRET`。

## 本地启动

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm prisma:generate
pnpm exec prisma migrate deploy
pnpm db:seed
pnpm dev
```

另开终端启动前端：

```bash
pnpm frontend:dev
```

Windows 本机也可以直接双击根目录的 `启动平台.bat`；停止服务使用 `停止平台.bat`。

默认开发账号密码：

```txt
admin / 123456
teacher001 / 123456
student001 / 123456
```

## 构建与检查

```bash
pnpm prisma:generate
pnpm build:all
```

数据库结构有更新时，启动新版本前执行：

```bash
pnpm exec prisma migrate deploy
```

## 常用认证接口

```txt
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/activity
GET  /api/v1/auth/me
POST /api/v1/auth/logout
```

Swagger 文档默认地址：`http://localhost:3000/api/docs`。

## 项目文档

- [产品需求文档](./PRD_产品需求文档.md)
- [API 接口文档](./API_接口文档.md)
- [数据库设计文档](./Database_数据库设计文档.md)
- [项目进展与优化建议](./docs/项目进展与优化建议.md)
- [外部编程题导入与测评说明](./docs/外部编程题导入与测评说明.md)
- [题目批量录入模板](./docs/题目批量录入模板.md)

Markdown、Word、PDF 等文档都可以提交到 GitHub；当前需求文档使用 Markdown，GitHub 可直接在线渲染、查看历史和评审变更。
