# 生成附加要求与检查

三张图片实际显示顺序与文件编号一致。前两张为 1487 × 1058，第三张为 1486 × 1058，均保留原始 PNG，未缩放或拉伸。

第二张与第三张的完整提示词由 `prompts.json` 中 commonPrompt、对应 direction 及以下附加文字顺序组成：

第二张附加：

> Precise platform assignment: Steam ONLY for Counter-Strike 2 and 星露谷物语. 三角洲行动、原神、崩坏：星穹铁道、鸣潮 all display 本地游戏. Never mark 原神 or 星穹铁道 as Steam. Selected Delta last played 今天00:42.

第三张附加：

> Precise platform assignment: Steam ONLY for Counter-Strike 2 and 星露谷物语. 三角洲行动、原神、崩坏：星穹铁道、鸣潮 all display 本地游戏. Never mark 原神 or 星穹铁道 as Steam. Local four cards fully visible with readable complete names. Date if shown 2026年10月24日 星期六.

第一张的部分平台标签是生成错误：原神、星穹铁道不能标为 Steam；若选此方案，需在实现或定稿时纠正。三张均是同风格布局概念，不代表游戏服务已接入。

三张图片均已在生成结果中直接查看：导航选中项、顶部外壳、薄荷色主操作及背景延续首页；六款游戏均完整出现；第二张为选中详情布局，第三张按来源分组。图片字体和游戏美术仍含生成细节，不作为原始游戏资产使用。

原始图片已安全移动到本目录并逐一校验 SHA-256，本轮确切 C 盘图像文件均不存在。空输出目录也已转存 D 盘 `.cache/generated-archive/library-concepts-empty-output-20261024`，未清理其他 C 盘目录。
