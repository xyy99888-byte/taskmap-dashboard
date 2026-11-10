# 云端版：独立账号、项目空间和本机同步

这是 Web 应用，另附本机 Python 同步程序。它不是浏览器插件，也不要求安装 skill。AI 工作窗口按根目录 `UPDATE_PROTOCOL.md` 维护记录即可。

## 组成

- Web Worker：HTTPS 网站、独立账号登录和项目 API。登录页公开，项目内容必须持有有效会话才能访问。默认使用用户名和密码，不需要 Cloudflare Access / Zero Trust。
- Sync Worker：仅提供配对和上传，不提供项目读取。设备凭证只允许上传其配对项目，数据库中只保存凭证哈希。
- Cloudflare D1：保存账号、会话、邀请、项目、设备、短期配对和最后一份进度快照。项目查询、配对、设备管理均检查所属用户。
- `sync_client.py`：每 10 秒上传本机已记录的进度；网站每 10 秒检查云端。网络及源记录写入还可能产生延迟，不能称为零延迟实时。

超过 90 秒未收到数据，页面显示“本机离线”，仍保留上次快照。一个项目同时只允许一个来源电脑；可撤销旧设备后换电脑，或给新电脑创建另一个项目。

## 部署

需要个人 Cloudflare 账号和 Workers/D1，无需开通 Zero Trust 或为登录功能绑定付款方式。可用额度以账号后台为准，本项目不自动开通付费套餐。

```sh
npm ci
npx wrangler login
npx wrangler d1 create project-progress
```

复制 `wrangler.web.example.jsonc`、`wrangler.sync.example.jsonc`，去掉 `.example`，将创建出的同一个 D1 ID 填入两份文件。个人配置已被 `.gitignore` 排除。

```sh
npx wrangler d1 migrations apply project-progress --remote --config wrangler.sync.jsonc
npm run deploy:sync
npm run deploy:web
```

得到两个 `*.workers.dev` 地址。Web 示例配置已设置 `AUTH_MODE=password`；匿名访问项目页会进入登录，匿名 API 请求返回 401。初次使用先生成邀请。

## 创建账号和邀请

部署者在自己的电脑运行以下命令生成一次性邀请（默认 24 小时有效）：

```sh
node scripts/invite.mjs --site https://YOUR_WEB.workers.dev --remote --output /PRIVATE/PATH/invite.json
```

打开生成文件中的 `url`，注册用户名和 14–128 个字符的密码（字母、数字、符号中至少两类；区分大小写；大小写字母同属一类，空格不算符号），并保存页面显示的账号恢复码。邀请只能创建一个账号。邀请文件包含秘密链接，应放在仓库外私人目录，不能公开上传。Windows 可使用 `E:\CodexData\tools\progress-dashboard\invites\first.json`。需要其他人使用时再生成新邀请；他们在各自电脑注册和配对，只能访问自己账号的项目。

密码使用独立随机盐的 PBKDF2-SHA256（100,000 次，Workers WebCrypto 的迭代上限），不保存明文。此工作因子低于一些专用密码哈希服务当前建议的参数；因此要求长密码，采用邀请注册、按账号和来源限速。会话凭证保存在 HttpOnly / Secure / SameSite Cookie 中，数据库只保存其摘要，最长 7 天。所有账号和项目写操作校验同源请求。退出会撤销当前会话；修改密码会撤销旧会话。注册和恢复时显示一次性恢复码，恢复会替换旧码，同时撤销所有旧会话和电脑连接。恢复码遗失且密码忘记时，没有邮件找回功能，需要部署者处理，不能在客户端自行重置。

保留可选的旧 Access 验证模块供已有部署迁移使用，但默认页面及退出流程面向内置账号模式；旧 Access 用户数据不会自动归属新账号。本次新部署尚无 Access 用户数据，无需迁移。

没有公开注册、公开分享、团队共享或邀请邮件发送。Cloudflare 基础设施账号所有者可以管理数据库；应用内账号隔离不意味着基础设施管理员无法访问数据。

## 连接电脑

在网站新建项目，再在已配置好本地任务数据的看板目录运行：

```sh
python sync_client.py connect --site https://YOUR_WEB.workers.dev --endpoint https://YOUR_SYNC.workers.dev --name "我的电脑"
```

浏览器打开配对页后，用自己的账号登录，核对设备名称和配对码，选择自己的项目并确认。只确认自己刚发起的配对。

```sh
python sync_client.py run
```

数据在其他文件夹时可加 `--root "D:\MyProgressData"`。保持进程运行才能持续同步，默认不修改系统自启动。凭证保存于本机 `local/sync-credentials.json`，90 天有效，可在网站随时撤销。

预览将上传的内容，不联网且无需配对：

```sh
python sync_client.py run --preview
```

只上传白名单进度字段；线程 ID 转为稳定不可读编号，常见 Windows 路径、本机预览和明显凭证格式会替换。任务名称、摘要和依据文字会上传。自动替换不是完整敏感信息检测，不要把密钥、客户原文写进进度记录。

## 验证与发布

```sh
npm test
npm run build
```

在上级目录运行 Python 测试：`python -m unittest discover -s tests -v`。测试覆盖账号隔离、同源操作、JWT、配对、撤销、过期、同步顺序及数据过滤。上线仍需浏览器登录和本机同步验收。新增测试覆盖邀请并发消费、密码登录、Cookie、会话过期、恢复码轮换和密码修改。

GitHub 用于版本管理，不是部署前提。不要上传 `.wrangler/`、`dist/`、`node_modules/`、真实项目记录、凭证及个人部署配置。初期手动部署，后续可为独立仓库增加 CI。程序代码变更需重新部署；任务进度由同步程序上传，无需提交 GitHub。

参考：[Workers WebCrypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)、[Workers D1](https://developers.cloudflare.com/d1/)。
