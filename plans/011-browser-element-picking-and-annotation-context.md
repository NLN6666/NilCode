# Plan 011 — 浏览器元素拾取与画布标注上下文

Status: TODO
Priority: P2
Effort: M
Depends on: —
Executor: 动代码前先完整读完本计划。遵守 STOP 条件，完成后更新 `plans/README.md` 的状态行。

## 目标

给应用内浏览器（`BrowserPanel`）增加两种把页面内容转成 agent 上下文的模式：

1. **Select（元素拾取）** —— 在页面上点选一个 DOM 元素，把它的结构信息（CSS selector、标签、id/类名、文本片段、尺寸位置、关键计算样式）加上一张该元素区域的裁剪截图，作为引用写入当前 thread 的 composer 草稿。
2. **Paint（画布标注）** —— 冻结当前页面截图，让用户在静态图上圈画标注，把合成后的 PNG 作为图片附件写入 composer 草稿。

两者都**只写草稿**。上下文在用户点击发送时才随消息发出 —— 不自动注入、不自动发起对话轮次。

面向的用户场景：让 agent 知道「改的是这个按钮」「这块区域对齐歪了」，而不必用户手写 selector 或口头描述位置。

## 当前 Synara 状态（2026-07-25 核实；代码变动快，动手前请重新确认）

### 浏览器子系统

- `apps/desktop/src/browserManager.ts`（2010 行）—— `DesktopBrowserManager`。每个 tab 一个 `WebContentsView`（`createLiveRuntime`，约 1419 行，`partition: BROWSER_SESSION_PARTITION`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`）。
  - `executeCdp`（约 984 行）：已实现 `webContents.debugger.attach("1.3")` + `sendCommand`，并在调用前做了 resume/attach/bounds 同步。
  - `subscribeToCdpEvents`（约 1040 行）：已实现 `debugger.on("message")` 订阅，返回退订函数。
  - `attachBrowserUseTab`：已有的 debugger attach 复用路径。
- `apps/desktop/src/browserIpc.ts`（152 行）—— 集中注册全部 browser IPC handler。
- `apps/desktop/src/ipcChannels.ts` —— `DESKTOP_IPC_CHANNELS.browser`（约 47–71 行）持有全部通道字符串；`BROWSER_IPC_CHANNELS` 是它的别名（73 行）。
- `packages/contracts/src/ipc.ts` —— `BrowserTabState`（262 行）、`ThreadBrowserState`（275 行）、`BrowserExecuteCdpInput`（404 行）、`BrowserControlMethods`（416–437 行）、`NativeApi.browser`（748 行附近）。
- `apps/web/src/components/BrowserPanel.tsx`（1639 行）—— 浏览器 chrome，宿主 `<webview>`（`BROWSER_WEBVIEW_PARTITION = "persist:synara-browser"`）。
  - `setBrowserWebviewOverlayOcclusion`（205 行）：用 `visibility`/`pointerEvents` 控制 webview 遮挡。
  - `hasNativeBrowserObscuringOverlay`（296 行）+ `syncBounds`（842 行）：覆盖层检测与 `setPanelBounds({ bounds: null })` 隐藏机制。
  - `onCaptureScreenshot`（1112 行）：现成的「截图 → composer 图片附件」路径，含 `PROVIDER_SEND_TURN_MAX_ATTACHMENTS` / `PROVIDER_SEND_TURN_MAX_IMAGE_BYTES` 校验。
  - `runBrowserAction`（594 行）：统一的错误捕获 → `setLocalError`。
- `apps/web/src/components/BrowserPanel.logic.ts` + `.logic.test.ts` —— 面板的纯逻辑与测试所在。
- `apps/web/src/lib/browserPromptContext.ts` —— `composerImageFromBrowserScreenshot`、`screenshotAttachmentName`。
- `apps/web/src/browserStateStore.ts` —— zustand 状态存储。

### composer 上下文类型的既有模式（本计划严格follow）

每一种「附加到草稿、发送时序列化进 prompt」的上下文都由同一套骨架构成，以 `fileComments` 为标准样板：

- `apps/web/src/lib/fileComments.ts` —— 纯逻辑：`FileCommentDraft` 接口、`normalize*`、`create*Draft`、`format*Label`/`format*Preview`、`build*PromptBlock`（产出 `<file_comments>…</file_comments>`）、`append*ToPrompt`、`extractTrailing*`、`stripTrailing*`。配套 `fileComments.test.ts`。
- `apps/web/src/composerDraftDomain.ts` —— `ComposerThreadDraftState`（160–183 行）持有 `images` / `files` / `assistantSelections` / `terminalContexts` / `fileComments` / `pastedTexts` / `skills` / `mentions` 等槽位；store actions 在 315–332 行附近（`addFileComment` / `removeFileComment` / `clearFileComments` 等）。
- `apps/web/src/composerDraftPersistence.ts` —— 草稿持久化。
- `apps/web/src/components/chat/ComposerPendingTerminalContexts.tsx`、`FileCommentsSummaryChip.tsx`、`ComposerReferenceAttachments.tsx` —— chip UI 样板。
- `apps/web/src/components/ChatView.logic.ts` —— 发送时把各类草稿拼进 prompt。
- `apps/web/src/lib/chatReferences.ts` —— 引用类型的汇总处。

**结论：painting 不需要新的草稿类型**，它的产物就是一张 PNG，现有 `images` 槽位原样能接。只有 element 拾取需要新增一个草稿槽。

## 已确认的设计决策（不要重新论证，直接实现）

| 决策            | 选定方案                              | 理由                                                                                                   |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 上下文流向      | 写入 composer 草稿，用户点发送才生效  | 用户明确要求；契合既有 `fileComments` / `terminalContexts` 模式                                        |
| 元素产物形态    | 结构文本 chip **+** 元素区域裁剪图    | agent 既能定位代码（selector/HTML/样式），又能看见长相（视觉类问题）                                   |
| painting 绘制层 | **先截图，再在静态图上画**            | 不碰页面 DOM、不受 CSP 限制、native 与 renderer 两种 surface 都成立；页面冻结反而避免滚动/动画干扰标注 |
| 拾取高亮        | **CDP 原生 `Overlay.setInspectMode`** | 零注入、跨 iframe 自动生效、实现量最小；外观是 Chrome DevTools 蓝紫盒模型，可接受                      |
| 裁剪图开关      | 默认附带，不做开关                    | 它就是普通 image 附件，不想要直接在附件区删除即可；加开关是多余状态                                    |

## 不可协商的约束

- `packages/contracts` **只放 schema/类型**，不放运行时逻辑。规范化/截断逻辑放 `packages/shared` 或归属的 app。
- `apps/desktop/src/browserManager.ts` 已 2010 行。**拾取逻辑必须单独成文件**，manager 里只保留薄委托方法。`CLAUDE.md` 明确把文件过大列为「做太多事」的信号。
- 页面返回的数据是**不可信输入**。任何来自 `Runtime.callFunctionOn` 的字段在离开主进程之前必须规范化、类型校验、长度截断。绝不把页面原始返回值直接塞进 prompt 或 IPC payload。
- IPC 变更只能是**加法**：不得重命名或改变现有 browser 方法的调用形状。
- 不注入常驻脚本、不使用 `Page.addScriptToEvaluateOnNewDocument`。拾取用一次性的 `Runtime.callFunctionOn`（只读求值，不改页面 DOM）。
- 任何开合动画必须使用共享的 disclosure motion（`apps/web/src/lib/disclosureMotion.ts` / `DisclosureRegion`），不得自写高度/透明度过渡。
- 遵守不可变更新：草稿与笔画数组一律返回新对象，不原地修改。
- 拾取模式必须在 tab 关闭、页面导航、面板卸载、debugger detach 时**自动清理**（`Overlay.setInspectMode({mode:"none"})` + 退订 listener），否则页面会卡在拾取态且无法交互。
- 不要运行 `bun fmt` / `bun lint` / `bun typecheck`，除非操作者在当前对话中明确要求（`plans/README.md` 既定规则）。测试一律 `bun run test`，绝不用 `bun test`。

## 工作流（按序执行；W1→W4 是核心链路，W5 可与 W2–W4 并行，W6 收尾）

### W1 — 契约与 IPC 通道

**`packages/contracts/src/ipc.ts`**（纯类型追加）

```ts
export interface BrowserElementRect {
  x: number; // 文档坐标（含滚动偏移），CSS 像素
  y: number;
  width: number;
  height: number;
}

export interface BrowserElementSelection {
  tabId: string;
  pageUrl: string;
  selector: string; // 稳定 CSS 选择器
  tagName: string; // 小写
  elementId: string | null;
  classNames: string[];
  textSnippet: string | null; // 已截断
  outerHtmlSnippet: string; // 已截断
  rect: BrowserElementRect;
  computedStyles: Record<string, string>; // 白名单属性
}

// 用 type 别名而非空 interface 继承，避免 no-empty-interface lint 报错
export type BrowserStartElementPickInput = BrowserTabInput;
export type BrowserCancelElementPickInput = BrowserThreadInput;

export interface BrowserElementPickedEvent {
  threadId: ThreadId;
  selection: BrowserElementSelection;
  screenshot: BrowserCaptureScreenshotResult | null; // 裁剪失败时为 null，不影响文本上下文
}

export interface BrowserElementPickCancelledEvent {
  threadId: ThreadId;
  reason: "user" | "navigation" | "tab-closed" | "error";
  message: string | null;
}
```

`BrowserControlMethods` 追加：

```ts
startElementPick: (input: BrowserStartElementPickInput) => Promise<void>;
cancelElementPick: (input: BrowserCancelElementPickInput) => Promise<void>;
onElementPicked: (listener: (event: BrowserElementPickedEvent) => void) => () => void;
onElementPickCancelled: (
  listener: (event: BrowserElementPickCancelledEvent) => void,
) => () => void;
```

**`apps/desktop/src/ipcChannels.ts`** —— `browser` 对象内追加，沿用 `desktop:browser-*` 命名：

```
startElementPick:      "desktop:browser-start-element-pick"
cancelElementPick:     "desktop:browser-cancel-element-pick"
elementPicked:         "desktop:browser-element-picked"
elementPickCancelled:  "desktop:browser-element-pick-cancelled"
```

**`apps/desktop/src/browserIpc.ts`** —— 按现有写法注册两个 `ipcMain.handle`，并新增 `sendBrowserElementPicked` / `sendBrowserElementPickCancelled` 两个推送函数（对标现有的 `sendBrowserCopyLink`）。

**`apps/desktop/src/preload.ts`** —— 暴露新方法与两个 `on*` 订阅（对标现有 `onCopyLink` 的写法）。

验证：`cd packages/contracts && bun run test`

---

### W2 — 主进程拾取会话

**新文件 `apps/desktop/src/browserElementSelectionBuilder.ts`（纯函数，无 Electron 依赖）**

职责：把页面返回的原始 payload 规范化成 `BrowserElementSelection`。这是不可信输入的校验边界。

```ts
export const BROWSER_ELEMENT_TEXT_MAX_CHARS = 200;
export const BROWSER_ELEMENT_HTML_MAX_CHARS = 1_200;
export const BROWSER_ELEMENT_SELECTOR_MAX_CHARS = 300;
export const BROWSER_ELEMENT_MAX_CLASS_NAMES = 12;

// 白名单：够 agent 判断布局/视觉问题，又不至于把数百个属性灌进 prompt
export const BROWSER_ELEMENT_STYLE_ALLOWLIST = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "border",
  "border-radius",
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "z-index",
  "overflow",
] as const;

export function buildBrowserElementSelection(input: {
  tabId: string;
  pageUrl: string;
  raw: unknown; // Runtime.callFunctionOn 的返回值，未经信任
}): BrowserElementSelection | null;
```

要求：

- `raw` 逐字段做类型判断，任一必需字段缺失/类型错误 → 返回 `null`（调用方降级处理，不抛异常炸掉拾取）。
- 字符串一律去掉控制字符、折叠空白、按上表常量截断（截断处补 `…`）。
- `computedStyles` 只保留白名单键，且值同样截断。
- `classNames` 去重、去空、截断数量。
- 数值字段做 `Number.isFinite` 校验，非有限值归零。

配套 `browserElementSelectionBuilder.test.ts`：正常 payload、缺字段、超长字符串、非法数值、白名单外属性、含控制字符的文本 —— 每种一条用例。

**新文件 `apps/desktop/src/browserElementPicker.ts`**

职责：封装一次拾取会话的完整生命周期。持有 `Map<threadId, ActivePickSession>`，保证同一 thread 同时只有一个会话。

流程：

1. `start(input)`：
   - 复用 manager 已有的 attach 路径确保 debugger 已挂载（参考 `attachBrowserUseTab`）。
   - 依次 `DOM.enable` → `CSS.enable` → `Overlay.enable`。
   - **调一次 `DOM.getDocument({ depth: 0 })`** 建立节点映射（不调的话 `resolveNode` 在部分页面会失败，这是 CDP 的已知前置条件）。
   - `Overlay.setInspectMode({ mode: "searchForNode", highlightConfig: { showInfo: true, contentColor: {...}, paddingColor: {...}, borderColor: {...}, marginColor: {...} } })`。
   - 通过 `subscribeToCdpEvents` 订阅，只处理 `Overlay.inspectNodeRequested`；同时监听导航/tab 关闭以便自动取消。
2. 收到 `Overlay.inspectNodeRequested { backendNodeId }`：
   - 立刻 `Overlay.setInspectMode({ mode: "none" })` 退出拾取态（不要依赖 Chrome 自动退出）。
   - `DOM.resolveNode({ backendNodeId })` → `{ object: { objectId } }`。
   - **一次** `Runtime.callFunctionOn({ objectId, functionDeclaration: EXTRACT_FN, returnByValue: true })` 取回全部字段。
   - `buildBrowserElementSelection` 规范化 → `null` 则以 `reason: "error"` 取消。
   - 裁剪截图：`Page.captureScreenshot({ format: "png", captureBeyondViewport: true, clip: { x, y, width, height, scale: 1 } })`。失败或元素尺寸为 0 时**降级为 `screenshot: null`**，不让整次拾取失败。
   - 推送 `elementPicked`，销毁会话。
3. `cancel(input)` / 自动清理：`Overlay.setInspectMode({ mode: "none" })` + 退订 + 从 Map 移除 + 推送 `elementPickCancelled`。

`EXTRACT_FN` 是一个字符串常量，在页面主世界里只读求值，返回：

```js
function () {
  const el = this;
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  // selector 生成：优先唯一 #id；否则 tag + 前若干 class；仍不唯一则从最近的稳定祖先
  // 起拼 :nth-of-type 路径，向上最多 5 层。
  return {
    selector, tagName, elementId, classNames, textSnippet,
    outerHtmlSnippet,
    rect: { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height },
    computedStyles,   // 只读白名单里的键
  };
}
```

注意：该函数在页面里跑，**不得修改任何 DOM**；`outerHTML` 与 `textContent` 在页面内就先做一次粗截断（避免把整个 `<body>` 通过 IPC 搬运），主进程再做权威截断。

**`apps/desktop/src/browserManager.ts`** —— 只加薄委托：`startElementPick` / `cancelElementPick`，以及把 picker 需要的 `sendCommand`/`subscribeToCdpEvents`/`getTabUrl` 以窄接口传入（便于测试注入假实现）。tab 关闭与导航时调用 picker 的清理钩子。

验证：`cd apps/desktop && bun run test src/browserElementSelectionBuilder.test.ts`

---

### W3 — composer 草稿槽与 prompt 序列化

**新文件 `apps/web/src/lib/browserElementContext.ts`（对标 `fileComments.ts` 逐项实现）**

```ts
export interface BrowserElementDraft extends BrowserElementSelection {
  id: string;
  createdAt: string;
}

export function createBrowserElementDraft(
  selection: BrowserElementSelection,
): BrowserElementDraft | null;
export function browserElementDedupKey(
  draft: Pick<BrowserElementDraft, "pageUrl" | "selector">,
): string;
export function formatBrowserElementLabel(d: BrowserElementDraft): string; // "button.btn-primary"
export function formatBrowserElementPreview(d: BrowserElementDraft): string; // 主机名 + 文本片段
export function buildBrowserElementsPromptBlock(items: readonly BrowserElementSelection[]): string;
export function appendBrowserElementsToPrompt(
  prompt: string,
  items: readonly BrowserElementSelection[],
): string;
export function extractTrailingBrowserElements(prompt: string): ExtractedBrowserElements;
export function stripTrailingBrowserElements(prompt: string): string;
```

prompt 块形态（与 `<file_comments>` 同构，缩进两格表示条目正文）：

```
<browser_elements>
- http://localhost:5173/dashboard — button.btn.btn-primary
  tag: button   id: submit-btn   classes: btn, btn-primary
  rect: 240,180 320x44
  styles: display=inline-flex; background-color=rgb(37,99,235); font-size=14px
  text: Save changes
  html: <button id="submit-btn" class="btn btn-primary">Save changes</button>
</browser_elements>
```

解析用与 `TRAILING_FILE_COMMENTS_PATTERN` 同构的尾块正则，保证 build → append → extract → strip 往返稳定。

配套 `browserElementContext.test.ts`：往返一致性、多条目、空数组返回空串、prompt 为空时不产生前导换行、含特殊字符的 selector、条目正文里出现 `- ` 开头的行不会被误判为新条目。

**`apps/web/src/composerDraftDomain.ts`** —— 追加 `browserElements: BrowserElementDraft[]` 到 `ComposerThreadDraftState`、`ComposerPromptHistorySavedDraft`、`QueuedComposerChatTurn`；追加 `addBrowserElement`（按 dedupKey 去重，返回 boolean）、`removeBrowserElement`、`clearBrowserElements`；`createEmptyThreadDraftState` 补默认 `[]`。

**`apps/web/src/composerDraftPersistence.ts`** —— 纳入持久化；**旧草稿 JSON 缺该字段时必须安全解码为 `[]`**。

**`apps/web/src/components/ChatView.logic.ts`** —— 发送路径按现有 `fileComments` 的位置拼接 `appendBrowserElementsToPrompt`，并在发送后清空该槽位。

验证：`cd apps/web && bun run test src/lib/browserElementContext.test.ts`

---

### W4 — BrowserPanel 拾取模式 UI

**`apps/web/src/components/BrowserPanel.logic.ts`** —— 新增纯状态机：

```ts
export type BrowserPanelInteractionMode = "browse" | "picking" | "annotating";
export function resolveNextInteractionMode(current, action): BrowserPanelInteractionMode;
```

模式互斥：进入 `picking` 自动退出 `annotating`，反之亦然。

**`apps/web/src/components/BrowserPanel.tsx`**

- 工具栏在「Copy screenshot」旁加两个 icon 按钮：拾取（`MousePointerClickIcon` 或 `~/lib/icons` 中已有的等价图标）、标注（`PenLineIcon` 等价物）。激活态用现有 `Button` 的 variant 表达，不要自造样式。
- 拾取模式：调 `startElementPick`；订阅 `onElementPicked` → `addBrowserElement` + （有 screenshot 时）`addImage`；订阅 `onElementPickCancelled` → 退出模式并按 reason 决定是否 `setLocalError`。
- **Esc 取消**：与现有 copy-link chord 的 keydown 监听同一模式实现。
- 附件上限：复用 `onCaptureScreenshot` 里已有的 `PROVIDER_SEND_TURN_MAX_ATTACHMENTS` 校验；超限时仍加文本 chip，只跳过图片并提示。
- 组件卸载 / thread 切换 / 面板关闭时必须 `cancelElementPick`。
- 图标按钮必须有 `aria-label` + `title` + `sr-only` 文本，与现有按钮保持一致。

`BrowserPanel.logic.test.ts` 扩展模式状态机用例。

---

### W5 — 画布标注（可与 W2–W4 并行）

**新文件 `apps/web/src/lib/browserAnnotation.ts`（纯逻辑）**

五种工具：**画笔 / 矩形 / 箭头 / 文字 / 马赛克**。用可辨识联合建模，不要用「一个 stroke 结构塞所有工具」的宽松形状 —— 文字没有 points，马赛克没有 color，硬塞会产生一堆永远为空的字段。

```ts
export type AnnotationTool = "pen" | "rect" | "arrow" | "text" | "mosaic";
export interface AnnotationPoint {
  x: number;
  y: number;
}

interface AnnotationItemBase {
  id: string;
}

export interface AnnotationPenItem extends AnnotationItemBase {
  tool: "pen";
  color: string;
  lineWidth: number;
  points: AnnotationPoint[];
}
export interface AnnotationRectItem extends AnnotationItemBase {
  tool: "rect";
  color: string;
  lineWidth: number;
  start: AnnotationPoint;
  end: AnnotationPoint;
}
export interface AnnotationArrowItem extends AnnotationItemBase {
  tool: "arrow";
  color: string;
  lineWidth: number;
  start: AnnotationPoint;
  end: AnnotationPoint;
}
export interface AnnotationTextItem extends AnnotationItemBase {
  tool: "text";
  color: string;
  fontSize: number;
  text: string;
  at: AnnotationPoint;
}
export interface AnnotationMosaicItem extends AnnotationItemBase {
  tool: "mosaic";
  blockSize: number;
  start: AnnotationPoint;
  end: AnnotationPoint;
}

export type AnnotationItem =
  | AnnotationPenItem
  | AnnotationRectItem
  | AnnotationArrowItem
  | AnnotationTextItem
  | AnnotationMosaicItem;

export const ANNOTATION_TEXT_MAX_CHARS = 120;
export const ANNOTATION_MOSAIC_BLOCK_SIZE = 12;

export function appendPenPoint(item: AnnotationPenItem, point: AnnotationPoint): AnnotationPenItem;
export function normalizeRect(
  a: AnnotationPoint,
  b: AnnotationPoint,
): {
  x: number;
  y: number;
  width: number;
  height: number;
};

// —— 撤销/重做历史：经典 past/present/future 快照模型 ——
export const ANNOTATION_HISTORY_MAX_DEPTH = 50;

export interface AnnotationHistory {
  past: readonly (readonly AnnotationItem[])[];
  present: readonly AnnotationItem[];
  future: readonly (readonly AnnotationItem[])[];
}

export function createAnnotationHistory(): AnnotationHistory;
export function commitAnnotationItem(h: AnnotationHistory, item: AnnotationItem): AnnotationHistory;
export function clearAnnotations(h: AnnotationHistory): AnnotationHistory;
export function undoAnnotation(h: AnnotationHistory): AnnotationHistory;
export function redoAnnotation(h: AnnotationHistory): AnnotationHistory;
export function canUndoAnnotation(h: AnnotationHistory): boolean;
export function canRedoAnnotation(h: AnnotationHistory): boolean;
export function hasVisibleItems(h: AnnotationHistory): boolean;
// 单一渲染函数：底图 + 全部标注，按插入顺序绘制
export function renderAnnotationScene(
  ctx: CanvasRenderingContext2D,
  base: CanvasImageSource,
  items: readonly AnnotationItem[],
): void;
export async function renderAnnotatedImage(
  base: ImageBitmap,
  items: readonly AnnotationItem[],
): Promise<Blob>;
```

全部不可变操作，返回新数组/新对象。

**架构要点：只用一个 canvas，底图也画进 canvas，不要用「`<img>` 底图 + 透明 canvas 覆盖」的双层结构。** 原因有二：马赛克必须能采样底层像素，双层结构下 canvas 读不到 `<img>` 的像素；而且单层结构让实时预览和最终导出走**同一个** `renderAnnotationScene`，预览所见即导出所得，从根上消除两者不一致的整类 bug。

各工具渲染规则：

- `pen`：`quadraticCurveTo` 平滑路径，`lineCap`/`lineJoin` 用 `round`。
- `rect`：`normalizeRect` 后 `strokeRect`，要支持反向拖拽（从右下往左上拉）。
- `arrow`：主线段 + 箭头两条短边，箭头大小随 `lineWidth` 缩放。
- `text`：`fillText`，加一圈同色描边或半透明底衬，保证在浅色和深色页面上都可读。
- `mosaic`：把目标区域按 `blockSize` 缩小后再放大回去（`imageSmoothingEnabled = false`），采样源是**当前 canvas 内容**而非原始底图 —— 这样先画的标注被马赛克盖住时也会一起被打码，符合直觉。

**马赛克的安全语义（必须落实）**：马赛克是用来遮蔽敏感信息的，绝不能只做视觉障眼法。展平后的 PNG 必须是**唯一**离开覆盖层的产物 —— 原始截图 Blob 和 `ImageBitmap` 在确认后立即释放（`bitmap.close()`），任何情况下都不得把未打码的原图单独加入草稿或附件。

配套 `browserAnnotation.test.ts`：五种工具各自的增删；pen 追加点的不可变性；`normalizeRect` 的反向拖拽；文字超长截断；空文字项被丢弃；`renderAnnotationScene` 对 mock ctx 的调用序列断言（不需要真实 canvas，mosaic 断言 `imageSmoothingEnabled` 被置 false 且用后复原）。

**新文件 `apps/web/src/components/browser/BrowserAnnotationOverlay.tsx`**

- props：`imageBitmap`、`onCancel`、`onConfirm(blob)`。
- 布局：单个 `<canvas>` 按 `object-contain` 等比铺满，工具条浮在底部。
- 工具条：五种工具切换、3–4 个预设颜色（文字与画笔共用）、撤销、清除、取消、「添加到对话」。马赛克不需要颜色选择，切到马赛克时颜色区置灰。
- 指针事件：`pointerdown/move/up` + `setPointerCapture`；坐标必须按 canvas 显示尺寸与位图尺寸的比例换算，否则高 DPI 下会错位。
- **拖拽中的项不进历史**：拖拽过程用一个独立的 `draftItem` 状态承载，渲染时按 `[...history.present, ...(draftItem ? [draftItem] : [])]` 合成；只在 `pointerup` 时 `commitAnnotationItem` 一次。若每个 `pointermove` 都提交历史，一笔画会产生上百条历史记录，撤销功能直接报废。
- **文字工具交互**：点击落点 → 在该位置浮出一个受控 `<input>` → Enter 或失焦提交 → 空内容则丢弃该项，不留空 item。输入态下 Esc 只取消当前这次输入，不影响已有标注。
- **撤销/重做**：工具条上必须有独立的「撤销」「重做」按钮，禁用态由 `canUndoAnnotation` / `canRedoAnnotation` 驱动。快捷键：撤销 `Ctrl/Cmd+Z`；重做 `Ctrl/Cmd+U` 与 `Ctrl/Cmd+Shift+Z` 两个都要绑（前者是本项目指定键位，后者是跨平台通用约定，用户两种习惯都能命中）。「清除」走同一套历史，因此**清除也可撤销**。
- **退出必须点按钮**：Esc **不关闭**标注覆盖层。用户可能已经画了很久，一次误触 Esc 就全丢。只有工具条上的「取消」和「添加到对话」两个按钮能关闭覆盖层；「取消」在已有标注时需二次确认。这条是刻意偏离常规模态框惯例的，实现时不要"顺手"把 Esc 关闭加回去。
- 无标注项时「添加到对话」禁用。
- 工具按钮要有 `aria-label` + `title`，当前选中态用 `aria-pressed` 表达。

**`BrowserPanel.tsx` 接线**

进入标注模式：`captureScreenshot` → `createImageBitmap` → 挂载覆盖层。

**关键约束**：覆盖层展开期间必须让浏览器 surface 让位，否则 native `WebContentsView` 会盖住它。复用现成机制，不要新造：`setBrowserWebviewOverlayOcclusion(webview, true)` + `setPanelBounds({ threadId, bounds: null, surface: "renderer" })`。退出标注模式时**显式恢复**（`setBrowserWebviewOverlayOcclusion(webview, false)` 并触发一次 `syncBounds`），不要依赖 `syncBounds` 自愈 —— 它只在 resize/transition 事件上触发，纯模式切换不会产生这些事件，页面会一直空白。

确认后：`renderAnnotatedImage` → `File` → 复用 `composerImageFromBrowserScreenshot` 同款构造（若签名不便复用，则在 `browserPromptContext.ts` 加一个 `composerImageFromAnnotatedBlob`，不要在组件里内联构造附件对象）→ `addImage` → 退出模式。

超过 `PROVIDER_SEND_TURN_MAX_IMAGE_BYTES` 时提示并保留覆盖层，让用户可以清除部分标注后重试。

---

### W6 — chip UI 与 transcript 回显

- **新文件 `apps/web/src/components/chat/ComposerBrowserElementChips.tsx`** —— 对标 `ComposerPendingTerminalContexts.tsx`：每个 chip 显示 `formatBrowserElementLabel`，副标题显示 `formatBrowserElementPreview`，右侧 `XIcon` 移除。hover 显示完整 selector 的 title。
- 挂载到 composer 的引用区（跟随 `ComposerReferenceAttachments.tsx` 里其他引用类型的既有位置与顺序）。
- transcript 侧：在渲染用户消息的位置调用 `stripTrailingBrowserElements`，把块内容渲染成只读 chip，与 `FileCommentsSummaryChip` 的处理方式保持一致。

## 不在范围内（不要做）

- 不做多元素框选/批量拾取。单次点选可重复累加多个 chip 已经够用。
- 不做元素的 DOM 树浏览器/断点/网络面板。需要完整 DevTools 时用现有的 `openDevTools`。
- 不做实时跟随页面滚动的标注图层（已明确否决，见设计决策表）。
- 不做标注的持久化/再编辑。合成后就是一张普通图片附件。
- 不改 `browserUsePipeServer.ts` 的 agent 自动化通道。本计划只服务于人工发起的上下文采集。
- 不给非 Electron 的 web 端做等价功能。`BrowserPanel` 本身就是 desktop-only。

## 验证

聚焦命令：

```
cd apps/desktop && bun run test src/browserElementSelectionBuilder.test.ts
cd apps/web && bun run test src/lib/browserElementContext.test.ts src/lib/browserAnnotation.test.ts src/components/BrowserPanel.logic.test.ts
cd packages/contracts && bun run test
```

手工验收（Electron 下）：

1. 打开浏览器面板 → 访问任意本地站点 → 点拾取 → 页面出现 Chrome 原生高亮 → 点一个按钮 → composer 出现一个元素 chip 和一张裁剪图。
2. 发送消息 → 消息里带 `<browser_elements>` 块 → transcript 中该块被折叠成 chip 而非裸 XML。
3. 拾取模式下按 Esc → 高亮消失、页面恢复可交互、无残留状态。
4. 拾取模式下切换 tab / 关闭 tab / 页面跳转 → 自动退出拾取态，页面不卡死。
5. 点标注 → 页面冻结成静态图 → 画几笔 → 撤销一笔 → 「添加到对话」→ composer 出现标注图 → 取消不产生任何附件。
6. 标注覆盖层展开时，native 浏览器视图确实被隐藏，没有穿透遮挡。
7. 附件数达上限时再拾取 → 文本 chip 仍加入，图片被跳过并有提示，不报错崩溃。

完整校验（仅在操作者明确要求时执行）：`bun fmt`、`bun lint`、`bun typecheck` 全部通过。

## STOP 条件

遇到以下情况停下来汇报，不要自行绕过：

- `Overlay.setInspectMode` 在 `<webview>` 宿主的 renderer surface 下不生效（只在 native `WebContentsView` 下工作）。这会推翻拾取方案的基础，需要重新决策（备选：注入自绘高亮）。
- `Runtime.callFunctionOn` 在目标页面被 CSP 或站点隔离阻断。
- `Page.captureScreenshot` 的 `clip` 坐标系与 `getBoundingClientRect + scrollX/Y` 对不上，且 `Page.getLayoutMetrics` 换算后仍偏移。
- 隐藏 webview 后覆盖层仍被 native 视图遮挡（说明现有遮挡机制不足以支撑标注模式）。
- 需要修改 `composerDraftPersistence.ts` 的既有持久化格式而非纯追加字段。

## 考虑过并否决的方案

- **用 `DOM.describeNode` + `DOM.getBoxModel` + `CSS.getComputedStyleForNode` + `DOM.getOuterHTML` 四条命令取数据**：否决。四次 IPC 往返换一次 `Runtime.callFunctionOn` 即可完成，且 `getBoxModel` 的 quad 坐标究竟相对视口还是相对文档在 CDP 中长期语义含糊，`getBoundingClientRect + scrollX/Y` 明确得多。
- **注入常驻脚本实现 hover 高亮以统一设计语言**：否决。需要自己处理 hover 命中、滚动、跨 iframe，出错面远大于收益；CDP 原生 overlay 零成本且跨 iframe 自动生效。
- **在活页面上叠透明 canvas 做实时标注**：否决。native `WebContentsView` 永远盖在 DOM 之上，该方案只在 renderer `<webview>` 下成立；且页面滚动后标注会错位。
- **把标注结果做成新的草稿类型**：否决。产物就是一张 PNG，现有 `images` 槽位原样能接，新增类型是无谓的复杂度。
- **给裁剪图加开关**：否决。它是独立的 image 附件，用户可直接在附件区删除；开关是多余状态。
