# 服务器一键安装部署

在一台全新的 Linux 服务器上以 `root` 执行下面指令，即可安装依赖、拉取 GitHub 代码、初始化数据库、构建前后端、配置 PM2 与 Nginx，并完成一次健康检查。

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/install.sh | bash -s -- --repo https://github.com/<owner>/<repo>.git --branch main --server-name <SERVER_IP_OR_DOMAIN>
```

如果服务器访问官方 npm 源慢或超时，使用国内镜像参数：

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/install.sh | bash -s -- --repo https://github.com/<owner>/<repo>.git --branch main --server-name <SERVER_IP_OR_DOMAIN> --china-mirror
```

依赖安装会复用上一 release 和 pnpm 缓存；单个源 7 分钟无结果时，按淘宝镜像、华为云、npm 官方源继续尝试。PostgreSQL 16 客户端同样支持阿里云镜像与官方源回退。GitHub clone 会使用 HTTP/1.1、浅克隆、低速超时和官方源码包 fallback；低于 2 GiB 内存的服务器应先配置至少 2 GiB swap，生产构建会限制安装并发与 Node 堆大小。

如果服务器访问 GitHub 持续超时，可在本机把当前 Git 提交打包后通过 SSH 上传部署，避免服务器直接拉取 GitHub：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-server.ps1 -Server aliyun -ChinaMirror
```

如需使用自有可信 GitHub 归档代理，可在服务器环境中设置逗号分隔的 `GITHUB_ARCHIVE_MIRRORS`，脚本会在官方源码包失败后按顺序尝试；不建议默认使用未知第三方源码代理。

脚本会强制校验 Node.js 主版本不低于 22；低于 22 会自动安装 Node.js 22，避免 pnpm/corepack 与项目 `engines` 不匹配。

如果需要部署当前开发分支，可以把 `--branch main` 改为对应分支名，例如：

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/deploy/install.sh | bash -s -- --repo https://github.com/<owner>/<repo>.git --branch <branch> --server-name <SERVER_IP_OR_DOMAIN> --china-mirror
```

常用参数：

```txt
--repo URL           Git 仓库地址，必填
--branch NAME       要部署的分支或标签
--app-root PATH     安装目录，默认 /opt/online-exam-platform
--server-name NAME  Nginx server_name，IP 或域名
--port PORT         后端端口，默认 3000
--seed              显式初始化演示数据（默认不执行）
--china-mirror      使用 registry.npmmirror.com 加速 npm/pnpm/corepack
--source-archive    使用服务器上的源码 tar/tar.gz，跳过 git clone
--archive-url       git clone 失败时使用的源码包 URL
```

默认部署目录：

```txt
/opt/online-exam-platform/current   当前线上版本软链接
/opt/online-exam-platform/releases  历史发布版本
/opt/online-exam-platform/shared    生产 .env、uploads、backups、恢复报告、PM2 配置
```

已有服务器再次部署时，脚本会复用 `/opt/online-exam-platform/shared/.env`，不会覆盖已有密钥。发布前先创建备份，再执行 Prisma 迁移和幂等的旧资源迁移。Nginx 不公开 `/uploads`，附件与导出由应用鉴权接口输出。

本次题型/材料题/评分历史版本包含新增表与增量迁移：`question_compositions`、`scoring_rule_versions`、`regrade_runs`、`scoring_evaluations`，并会补齐细分权限与中文权限名称。生产升级顺序建议固定为：创建备份并完成隔离恢复校验 → 拉取新 release → `pnpm exec prisma migrate deploy` → `pnpm permissions:sync` → 构建与重启 PM2 → 验证登录、AI 读取权限、题库、考试、批改、附件预览和导出下载。

`permissions:sync` 会幂等登记权限并为 AI 用户补齐新增读取权限，同时保留超级管理员已手动关闭的读取项；不要在迁移后省略该步骤。一键部署脚本已自动执行。

## 备份与恢复演练

部署脚本会安装 `online-exam-platform-backup.timer`，每日北京时间 02:30 运行。查看下次执行时间：

```bash
systemctl list-timers online-exam-platform-backup.timer
```

生产隔离演练不停服也不覆盖现有数据：

```bash
cd /opt/online-exam-platform/current
pnpm backup:create
pnpm backup:verify | tee /opt/online-exam-platform/shared/restore-reports/restore-$(date +%F-%H%M%S).json
```

演练会恢复到临时 `_restore_verify_` 数据库和隔离 uploads 目录，比对迁移版本、关键表行数和文件 SHA-256 后自动清理。

## SSH 安全

自动发布前应安装专用 Ed25519 公钥，并用 `ssh -o BatchMode=yes root@<host> true` 确认无密码连接。密码和私钥不得写入仓库、命令日志或聊天记录。
