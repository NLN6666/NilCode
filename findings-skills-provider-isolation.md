# Findings —— Skills 按 Provider 运行时隔离（子项目 A）

记录实施过程中踩到的坑与实测结论，供后续排查参考。
最后更新：2026-08-10T07:41:33Z

---

## 1. 改 `skills.disabled` 的 schema 形状会静默清空用户全部设置

**背景：** 把 `settings.skills.disabled` 从扁平数组 `string[]` 改成按 provider 分桶的对象。

**坑：** `apps/server/src/serverSettings.ts` 的 `loadSettingsFromDisk` 在 decode 失败时，会把整个
`settings.json` **隔离改名**（`.invalid-<timestamp>`）并回退到默认值。老用户磁盘上的
`"disabled": ["foo"]` 遇到新 schema 必然 decode 失败 —— 结果不是"这一项丢了"，而是**用户的每一项
无关设置都被重置**（provider 路径、代理、模型选择全没）。

**结论：** 形状迁移必须在 `Schema.decodeUnknownExit` **之前**做。实现为
`migrateLegacyDisabledSkills()`，在 `decodeSettingsFromJson` 里包住入参；老的全局列表扇出到全部 9 个
provider（语义等价：原来就是全局生效）。同时 `SERVER_SETTINGS_MIGRATION_VERSION` 1 → 2，触发一次
重写落盘。

**教训：** 凡是改持久化 schema 的形状（而不只是加可选字段），先去看加载器 decode 失败时干什么。
这个仓库的策略是"隔离 + 回退默认"，属于静默数据丢失，不会报错给用户。

---

## 2. `ProviderDiscoveryService.test.ts` 会扫到开发者本机真实的 `~/.claude/skills`

**现象：** 断言 `expect(result.skills.map(s => s.name)).toEqual(["portable"])` 实际收到 53 个技能，
里面是 `paseo`、`blockbench-*`、`django-patterns` 等本机真实技能。

**排查过程（避免重走）：**

1. 先怀疑是本次改动引入 —— `git stash` 后在干净 `dev` 上重跑，**同样 3 个 fail**，确认是既有问题
   （本次改动后反而只剩 2 个 fail，隔离顺带修好了一个）。
2. 再怀疑 `discoverClaudePluginSkillRoots` 读了真实 home —— 读代码确认它用的是传入的
   `input.homeDir`，不是 `os.homedir()`，排除。
3. 真正原因：测试用 `mkdtempSync(path.join(os.tmpdir(), ...))` 造 `cwd`，**Windows 上 `os.tmpdir()`
   是 `C:\Users\<user>\AppData\Local\Temp`**。`rootsForOrderedOrigins` 会沿 `cwd` 逐级向上找
   project 根，爬到 `C:\Users\<user>` 时命中真实的 `.claude\skills`，以 scope `project` 混入结果。

**为什么生产环境没事：** `rootsForOrderedOrigins` 里有 `homeRootPaths` 去重 —— 真实运行时
`homeDir` 就是真实 home，那个目录会被识别成 home origin 而跳过。只有测试里 `homeDir` 是伪造的
临时目录，去重才对不上。**产品行为无缺陷，是测试断言对环境敏感。**

**修法：** 把精确列表断言改成成员断言（`toContain` / `not.toContain`），断言测试自己写入的技能，
不受本机既有技能影响。没有改动产品逻辑。

**注意：** 同类断言（`toEqual([...])` 配合 `cwd` 走临时目录）在别处也可能踩到，Windows 尤其。

---

## 3. Web 端手抄了一份 origin → provider 映射，且已抄错

**现象：** `~/.factory/skills` 下的 Factory Droid 技能在设置页既不显示 provider 图标、也归不进分区。

**根因：** server 端 `skillsCatalog.ts` 给该目录打的 scope 是 `factory`（按目录名），而 web 端
`skillsSettingsModel.ts` 的 `originProvider()` 在匹配 `"droid"`（按 ProviderKind 名），永远匹配不上，
落到 `default` 分支。两份表各写各的，漂移无人察觉。

**修法：** 抽到 `packages/shared/src/skillOrigins.ts` 作单一事实源，两端都从这里读。同时把
"谁拥有这个目录"（用于分区标题）和"谁会读这个目录"（用于图标/开关范围）拆成两个概念 —— 原来
1:1 的假设是错的，`~/.claude/skills` 有 6 个 provider 会读。
