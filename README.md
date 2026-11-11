# Taskmap Dashboard · 项目进度看板

一个在本机运行的只读进度页面：按项目、支线、工作窗口和任务查看完成情况、阻塞、依赖、验收依据及里程碑。

本地版只需要 **Python 3.10 或以上**。使用 Python 标准库和原生 HTML/CSS/JavaScript，没有 pip/npm 安装步骤。云端部署另需 Node.js 和 Cloudflare 账号，见 `cloud/README.md`。Windows、macOS、Linux 均可按下面的 Python 命令运行；Windows 启动脚本已提供。当前实际验证环境为 Windows。

## 快速运行

在本目录打开终端：

```sh
python server.py --open
```

macOS / Linux 如果命令名为 `python3`，替换为 `python3 server.py --open`。

Windows 也可以双击 `start.cmd`。打开 <http://127.0.0.1:8765/>。停止服务可在运行终端按 Ctrl+C。

默认展示 `demo/project.json` 中的**虚构示例**，不访问 Codex 记录。端口被占用时可用 `python server.py --port 8766 --open`。

## 用自己的项目

1. 将 `config.example.json` 复制为 `config.json`。
2. 新建 `local` 文件夹，将 `demo/project.json` 复制为 `local/project.json`。
3. 把 `config.json` 中的 `dataFile` 改为 `local/project.json`，再填写你的项目和任务。
4. 页面会按照 `refreshSeconds` 自动重读数据，默认每 5 秒一次。修改数据后无需重新启动。

`config.json` 和 `local/` 已被 `.gitignore` 排除。提交代码前仍应检查暂存文件；`.gitignore` 不会自动移除已经提交过的数据。

## 数据与更新

### 项目时间轴

默认展示“进展轨迹”：模块按行、日期按列，点击数字节点查看记录与详情。复核时间来自窗口记录，实际完成来自任务 `completedAt`，看板观察来自采集历史；不使用聊天更新时间推算任务日期。已保存的复核时间会积累为历史节点，当前窗口的同一条复核记录不会重复展示。视图选择在当前浏览器按项目记忆。

“计划排期”的待定日期列表只包含未完成任务，已完成但没有计划日期的旧成果单独折叠。没有排期仍显示日期轴和模块行，并提供进展轨迹入口；无需补造日期才可查看。

总览提供“进展轨迹 / 计划排期”切换。初次打开按现有日期选择范围；支持两周／一个月按天、十二周按周、前后翻页、回到今天、模块与状态筛选，点击任务进入原有详情。未记录日期的任务单独列出，部分日期用虚线标记，过期未完成用红框提示。日期字段见 `UPDATE_PROTOCOL.md`。

历史从新版采集器首次读取时开始：首次仅记录基线，之后记录新增、移出、状态和日期变化。每项目最近 200 条保存在数据目录 `local/timeline.sqlite`，由同步程序上传到所属云端项目的快照内；不上传数据库文件。它不是完整审计日志，也不反推过去每天的完成度。各日统计来自当天保留的观测，不补造无记录日期。代码升级后需重启本机采集器；网页只负责展示。

运行文件现包含 `timeline.py`、`timeline-model.js` 和 `timeline.js`，分发代码时须一起保留。个人时间轴数据库始终排除在 Git 之外。

总览中的模块进度图以 0%–100% 为横轴，每行代表一个模块。颜色分别表示已完成、进行中、待验收、阻塞或待依赖、其他待办，右侧列出剩余数量和任务摘要。暂无清单的模块显示为“待梳理”，不填造百分比。小屏幕可在图表内横向滚动。

点击模块、状态色块、窗口标题、待办或里程碑，可以进入详情页。详情支持按窗口和任务状态筛选、搜索完整记录、查看验收依据及跳转关联任务；浏览器返回键、直接保存详情网址和自动刷新均可使用。详情地址使用 `#/module/<模块 id>`，因此每条支线应填写稳定且唯一的 `id`。

- 项目由 `lanes` 组成，每条支线有 `windows`，每个工作窗口有 `tasks`。
- 每个窗口使用稳定的 `id`，每项任务使用在整个项目中唯一的 `id`。
- 任务状态：`todo`、`in_progress`、`review`、`blocked`、`done`、`cancelled`。
- `stage` 单独表示交付阶段：`local`、`merged`、`deployed`、`delivered`、`unverified`。代码本地完成不会自动变成已上线。
- `priority` 为 P0–P3；`dependsOn` 通过任务 ID 关联其他支线；`acceptance` 记录验收标准；`evidence` 记录依据；`blocker` 和 `nextAction` 说明阻塞及所需行动。
- `milestone` 相同的任务会汇总到同一阶段。取消项不计入完成度；没有任务清单的窗口单独标注。
- 完成度按任务数量等权计算，不代表工时或成本。计划越完整，百分比越有参考价值；任务粒度应尽量一致。

每个窗口可以在 `local/updates/<窗口 id>.json` 写自己的更新。字段和约定见 [UPDATE_PROTOCOL.md](UPDATE_PROTOCOL.md)。页面自动读取，不需要手动把多份记录合并。

自动刷新负责读取已经写下的状态，**不会从聊天正文或代码变化中猜测任务已经完成**。任何编辑器、脚本或 AI 工具都可以按该约定写 JSON。

页面的“最近检查”只表示读取服务的时间，不代表任务刚完成复核。顶部会显示窗口进度文件、Markdown 看板和快照分别覆盖多少窗口，并标出最近一次任务复核时间；各窗口自己的复核时间在详情中查看。

旧格式的 `{"title": "任务", "done": true}` 仍可读取；缺少验收或交付阶段时不会自行补造。

## 可选的 Markdown 看板

在 `config.json` 中按窗口 ID 配置文件：

```json
{
  "markdownBoards": {
    "backend": "local/backend-board.md"
  }
}
```

读取标准 `- [ ]` / `- [x]` 清单。配置了 Markdown 的窗口，以该文件作为任务和复核时间来源，覆盖该窗口 JSON 更新里的任务清单。避免同一窗口同时维护两套任务状态。

## 多项目切换与窗口待办

在 `config.json` 中配置 `projects` 数组；每个项目使用独立的数据文件和更新目录，例如：

```json
{
  "defaultProject": "shop",
  "projects": [
    {"id": "shop", "name": "店铺", "dataFile": "local/shop.json", "updatesDir": "local/shop-updates"},
    {"id": "admin", "name": "管理后台", "dataFile": "local/admin.json", "updatesDir": "local/admin-updates"}
  ]
}
```

侧边栏选择项目，链接会保留 `?project=项目ID`。未配置数组时兼容原来的单项目配置。进度图直接列出正在运行的窗口，以及仍有“进行中”任务的窗口，显示其未完成清单；点击事项可跳到详情。窗口动态比任务记录更新时，会显示待复核提示。未登记任务时显示未知进度。

云端同步使用 `python sync_client.py --credentials local/shop-sync.json run --project shop` 选择本地项目。每个云端项目分别配对，分别保存凭证并运行同步；此参数不会自动给所有项目建立云端连接。

## 可选的 Codex 窗口动态

把 `codex.enabled` 设为 `true`，并填写 `codex.home`（默认 `~/.codex`）。在对应窗口数据中填写 `threadId`。

此功能仅以 SQLite 只读连接获取会话更新时间和最近一轮状态，**不读取聊天正文**。它依赖本机内部数据库 `state_5.sqlite` 和 `thread_history_1.sqlite`，并非稳定公开接口，Codex 更新后可能需要调整。数据库缺失、锁定或结构变化时，任务清单继续显示，窗口动态标为不可用。关闭此项后完全不需要 Codex。

## 发布到 GitHub

本目录的代码、虚构示例、文档和测试可以组成一个独立仓库。个人项目数据应继续放在 `local/`，不要上传实际任务快照、聊天记录、数据库或凭证。

推荐纳入的文件：`server.py`、`sync_client.py`、`app.js`、`index.html`、`style.css`、`favicon.svg`、`config.example.json`、`demo/`、`start.cmd`、`README.md`、`UPDATE_PROTOCOL.md`、`DESIGN_NOTES.md`、`tests/`、`.gitignore`，以及 `cloud/` 中的源码、测试、示例配置、文档、`package.json` 和 `package-lock.json`。不要包含依赖目录、构建产物、本地测试文件或个人配置。

别人下载代码后可在自己的电脑上运行，配置自己的项目数据。**上传 GitHub 不等于在线托管看板**：GitHub Pages 不能运行这里的 Python 服务，也不能读取本机文件。本地服务固定监听 `127.0.0.1`；现已另有带登录、独立用户空间和本机同步的云端实现，部署方法见 [cloud/README.md](cloud/README.md)。云端实现部署后用一次性邀请创建独立账号；无需 Cloudflare Access 或 Zero Trust。

## 验证

```sh
python -m unittest discover -s tests -v
```

测试使用临时虚构数据，覆盖无 Codex 环境、异常更新、状态计算、依赖关系和私有文件不被 HTTP 提供。

## 许可

此版本尚未指定开源许可证。公开发布前，由仓库所有者选择许可。若希望别人可以使用、修改和分发，可考虑 MIT；仅设为公开仓库并不能代替明确的开源许可。

## 方法参考

设计思路参考 OpenAI 的 Linear 和 Notion 实施计划 skill，详见 [DESIGN_NOTES.md](DESIGN_NOTES.md)。本项目没有安装或捆绑它们，也不需要连接这些平台。


## 页面导航

固定侧边栏提供项目切换、项目总览、项目时间轴、全部任务、工作窗口和各模块入口。手机宽度下使用抽屉菜单。

- `#/overview`：项目摘要、模块进度、下一步和阶段交付。
- `#/timeline`：进展轨迹与计划排期。
- `#/windows?filter=todo`：按状态筛选工作窗口，可展开快速清单。
- `#/tasks`、`#/module/<模块ID>`：任务搜索、状态筛选、窗口和任务详情。

返回按钮优先返回站内上一页，直接打开详情时返回上一级。浏览器前进/返回恢复筛选、时间范围、展开行和滚动位置；切换项目保留主要页面，但清除属于旧项目的模块和筛选。刷新失败保留上次数据，并提供重试或重新登录入口。

导航实现为 `navigation-model.js`、`navigation.js` 和 `navigation.css`，云端构建和本地服务均包含它们。路由测试：在 `cloud` 执行 `npm test`。设计依据见 [NAVIGATION_DESIGN.md](NAVIGATION_DESIGN.md)。
