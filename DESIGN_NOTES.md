# 借鉴的方法与本项目选择

研究时间：2026-11-09。下列链接为研究时读取的官方文件；上游后续可能变化。

| 参考 | 读取到的方法 | 在本项目中的实现 |
| --- | --- | --- |
| [OpenAI Linear skill](https://github.com/openai/skills/blob/main/skills/.curated/linear/SKILL.md) | 项目与任务分层、优先级、发布里程碑、跨项目依赖、发现过期状态 | 项目→支线→窗口→任务，优先级排序、里程碑汇总、依赖未完成提示和复核标记 |
| [Notion spec-to-implementation](https://github.com/openai/skills/blob/main/skills/.curated/notion-spec-to-implementation/SKILL.md) | 需求、计划与任务互相关联；任务附验收标准、依赖和资源 | 稳定任务 ID、验收标准、依据与依赖字段，展开查看任务详情 |
| [Notion progress tracking](https://github.com/openai/skills/blob/main/skills/.curated/notion-spec-to-implementation/reference/progress-tracking.md) | 待做→进行中→待验收→完成，单独记录阻塞；重大进展后更新同一来源 | 六种任务状态；每个窗口独立更新文件；每 5 秒读取；无效更新保留上次完整记录 |

这是对组织方式的借鉴，没有复制 skill 的正文作为产品实现，也没有安装其 MCP 服务。Linear 和 Notion 的平台数据访问、OAuth 和云端协作能力不随本项目附带。

这里的窗口执行动态与任务完成状态是两个维度。某个 AI 窗口空闲，不表示该支线完成。系统只有在清单中明确记录完成时才计入完成比例。

同样，`done` 与 `stage` 分开记录：按验收范围认定任务完成，再标明其成果处于本地、合并、上线或交付哪一阶段。

当前没有实际运行 Linear、Notion 集成，只审阅了上述公开 workflow 文件；这些参考不构成对平台功能、可靠性或安全性的完整测试。
