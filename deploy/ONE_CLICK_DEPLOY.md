# 服务器一键安装部署

在一台全新的 Linux 服务器上以 `root` 执行下面指令，即可安装依赖、拉取 GitHub 代码、初始化数据库、构建前后端、配置 PM2 与 Nginx，并完成一次健康检查。

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/install.sh | bash -s -- --repo https://github.com/<owner>/<repo>.git --branch main --server-name <SERVER_IP_OR_DOMAIN>
```

如果服务器访问官方 npm 源慢或超时，使用国内镜像参数：

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/install.sh | bash -s -- --repo https://github.com/<owner>/<repo>.git --branch main --server-name <SERVER_IP_OR_DOMAIN> --china-mirror
```

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
```

默认部署目录：

```txt
/opt/online-exam-platform/current   当前线上版本软链接
/opt/online-exam-platform/releases  历史发布版本
/opt/online-exam-platform/shared    生产 .env、uploads、backups、恢复报告、PM2 配置
```

已有服务器再次部署时，脚本会复用 `/opt/online-exam-platform/shared/.env`，不会覆盖已有密钥。发布前先创建备份，再执行 Prisma 迁移和幂等的旧资源迁移。Nginx 不公开 `/uploads`，附件与导出由应用鉴权接口输出。

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
