# xcb-sys-v3

通过coolq-http-api使用酷Q开发的小糍粑机器人系统后台。

## Install

- 安装[CoolQ Pro](https://cqp.cc/t/14901)及[coolq-http-api](https://github.com/richardchien/coolq-http-api/releases)
- 安装[Node](http://nodejs.cn/download/)及npm(Node自带)
- 安装[MySQL](https://dev.mysql.com/downloads/mysql/)
- 下载xcb-sys

```bash
git clone https://github.com/DavidDiao/xcb-sys-v3.git
```

- 根据example创建配置文件.env和database.json，修改coolq-http-api配置文件
- 建立数据库
- 安装需求库并数据库迁移

```bash
npm install -g db-migrate
# 速度慢可使用淘宝镜像 --registry=https://registry.npm.taobao.org
npm install
db-migrate up
```

- 启动bot

```bash
node index.js
```
