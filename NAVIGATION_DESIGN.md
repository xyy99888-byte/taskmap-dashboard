# Taskmap 导航与交互设计

## 结构

账户层“我的项目”管理项目和设备；进入项目后，侧边栏先放项目切换，再放同一项目的四个视图，最后列出模块。总览保留决策摘要，时间轴和窗口清单各有完整页面。两层均有一致品牌和移动导航。

项目 → 模块 → 窗口 → 任务是数据层级；总览 / 时间轴 / 任务 / 窗口是同一份数据的视图，不生成重复任务。面包屑标明位置，“返回”回到来源，“返回上一级”回到数据父级。页面深链接继续有效。

## 交互

浏览器 history.state 保存当前页面滚动、时间轴筛选与尺度、展开行；URL 保留任务搜索与状态。切换项目清除旧对象定位。重复刷新和提交使用进行中保护；失败保留已读取记录。设备管理使用原生模态 dialog，关闭或切换设备后丢弃过期请求。小屏抽屉支持 Escape、焦点约束和背景 inert。

## 参考

2026-11-11 阅读以下官方资料，并据此调整信息架构，没有复制平台的业务数据或品牌资产：

- Linear conceptual model: https://linear.app/docs/conceptual-model — 工作空间、项目和事项的层级；多个视图对应同一份工作。
- GitHub Primer NavList: https://primer.style/product/components/nav-list/ — 导航分组、当前页面标记和语义化导航。
- GitHub Projects views: https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/managing-your-views — 视图独立，保留筛选与布局上下文。

## Figma

示例页面已通过官方网页导入写入 Figma：https://www.figma.com/design/JSnegZPbMqFYRDxtnnJaWs?node-id=1-2 。使用虚构项目数据。当前是网页导入的可编辑图层；组件编辑接口受限额影响，未声称已转换成组件库。捕获脚本只放在 E 盘预览目录，不参与部署，不改变生产 CSP。
