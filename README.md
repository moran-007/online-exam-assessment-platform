# 在线答题与智能测评平台后端

这是根据三份需求文档搭建的 NestJS + Prisma 后端基础框架，接口统一前缀为 `/api/v1`。

## 已完成

- NestJS 项目骨架与统一响应格式。
- Prisma/PostgreSQL 数据模型，包含 MVP 核心表，并预留 Hydro、AI、外部登录账号绑定表。
- JWT Access Token + Refresh Token 登录、刷新、退出、当前用户接口。
- 模块化认证 provider，当前实现 `password`，后续可新增第三方平台登录 provider。
- 全局登录守卫、角色守卫、权限守卫。
- 课程、知识点树、标签基础接口。
- 审计日志服务与初始化 seed。
- PostgreSQL、Redis、MinIO 的 `docker-compose.yml`。

## 本地启动

```bash
cp .env.example .env
docker compose up -d
pnpm prisma:migrate --name init
pnpm db:seed
pnpm dev
```

Windows 本机也可以直接双击根目录的：

```txt
启动平台.bat
停止平台.bat
```

`启动平台.bat` 会启动 `D:\PostgreSQL` 中的本地 PostgreSQL、执行迁移和 seed、启动后端与前端。

默认账号密码：

```txt
admin / 123456
teacher001 / 123456
student001 / 123456
```

## 常用接口

```txt
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
GET  /api/v1/courses
GET  /api/v1/knowledge-points/tree
GET  /api/v1/tags
```

Swagger 文档默认地址：

```txt
http://localhost:3000/api/docs
```

更多进度和优化建议见：

```txt
docs/项目进展与优化建议.md
```

外部编程题导入、Hydro 计分、考试作答与批改流程见：

```txt
docs/外部编程题导入与测评说明.md
```
