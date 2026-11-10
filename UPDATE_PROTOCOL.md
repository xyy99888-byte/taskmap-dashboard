# 窗口进度更新约定

每个窗口只更新自己的文件：`local/updates/<窗口 id>.json`。目录可通过 `config.json` 的 `updatesDir` 改写。窗口 ID 必须已登记在项目文件中，允许字母、数字、短横线、下划线和单点号，不允许路径。

在以下时机更新：完成重要事项、准备验收、发现阻塞、解除阻塞、交付里程碑。先复核实际状态，再写入。建议写入同目录临时文件，完成后原子替换目标文件；短暂的无效 JSON 会提示并保留上次完整更新。

```json
{
  "reviewedAt": "2026-11-01T09:00:00Z",
  "summary": "接口本地完成，等待前端联合验收。",
  "evidence": "本地测试记录；尚未部署。",
  "tasks": [
    {
      "id": "api",
      "title": "完成查询接口",
      "status": "done",
      "priority": "P1",
      "stage": "local",
      "milestone": "可用原型",
      "acceptance": "合法请求成功，非法输入返回明确错误",
      "evidence": "本地测试通过"
    },
    {
      "id": "integration",
      "title": "完成前后端联合验收",
      "status": "blocked",
      "priority": "P1",
      "dependsOn": ["api"],
      "blocker": "缺少演示账号",
      "nextAction": "项目负责人提供账号",
      "milestone": "联调验收"
    }
  ]
}
```

`tasks` 是该窗口的完整清单，更新时整体替换；保留稳定的任务 ID。`reviewedAt` 使用实际复核时间，必须带时区。不要通过改时间掩盖尚未核实的内容。

`done` 表示已达到这项任务自己的验收范围。开发任务完成可以同时标注 `stage: local`；发布与线上验收应另设任务。需要业务确认的结论，应写在 `blocker`，不自行认定。

不要在进度记录中写入密钥、完整客户隐私或聊天原文。依据可以是简短测试结果或相关记录的位置。
