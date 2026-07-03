# 服务器一键安装部署

在一台全新的 Linux 服务器上以 `root` 执行下面指令，即可安装依赖、拉取 GitHub 代码、初始化数据库、构建前后端、配置 PM2 与 Nginx，并完成一次健康检查。

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/install.sh | bash -s -- --branch main --server-name <SERVER_IP_OR_DOMAIN>
```

如果需要部署当前开发分支，可以把 `--branch main` 改为对应分支名，例如：

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/deploy/install.sh | bash -s -- --branch codex/external-oj-import-fillblank --server-name <SERVER_IP_OR_DOMAIN>
```

常用参数：

```txt
--repo URL           Git 仓库地址，默认当前 GitHub 仓库
--branch NAME       要部署的分支或标签
--app-root PATH     安装目录，默认 /opt/online-exam-platform
--server-name NAME  Nginx server_name，IP 或域名
--port PORT         后端端口，默认 3000
--skip-seed         跳过初始化演示数据
```

默认部署目录：

```txt
/opt/online-exam-platform/current   当前线上版本软链接
/opt/online-exam-platform/releases  历史发布版本
/opt/online-exam-platform/shared    生产 .env、上传文件、PM2 配置
```

已有服务器再次部署时，脚本会复用 `/opt/online-exam-platform/shared/.env`，不会覆盖已有数据库密码和 JWT 密钥。
