# PokéBonk Co-op Connection Doctor

**联机诊断与有限恢复工具 · 1.3.0**

[English](README.en.md) · [安装脚本](https://raw.githubusercontent.com/NIGHMET/pb-coop-tool/main/pb-coop-fix.user.js) · [适配其他游戏](docs/ADAPTERS.md) · [验证记录](docs/VALIDATION.md)

**已经装了油猴？[下载安装文件](https://github.com/NIGHMET/pb-coop-tool/releases/download/v1.3.0/pb-coop-tool-install.user.js)，拖到「油猴 → 管理面板 → 已安装脚本」页面中间，再点「安装」。不用复制代码。[详细步骤](docs/INSTALL.md)**

用于 [PokéBonk](https://pokebonk.com) 的浏览器合作模式。展示连接状态，在连接失败后有限重试，并导出脱敏诊断。**当前仅适配 PokéBonk；尚未验证真实跨网络双人游戏的恢复效果。**

这是独立社区工具，与游戏作者无关联。仓库只包含工具和自编测试，不包含游戏代码、素材、账号或服务器凭证。

## 安装与使用

1. 安装支持页面上下文脚本的用户脚本管理器（如 Tampermonkey / Violentmonkey）。
2. 打开上面的「安装脚本」，或新建脚本并粘贴 `pb-coop-fix.user.js` 的完整内容。
3. 刷新游戏并进入合作房间，等待右侧面板识别房间。首次先保留默认设置。
4. 如果持续显示「等待游戏房间接入」，不要当作已启用；脚本管理器的注入方式、CSP 或游戏更新都可能影响接入。

浏览器/脚本管理器组合的安装兼容性尚未全部测试。自动接入依赖页面已经加载的同源模块导出 `App` 及其 `frameGap()`；不下载另一份游戏，不修改游戏 bundle，不假设存在 `window.ctx`。较晚粘贴到控制台也会尝试接入；完整诊断最好在页面启动前注入。

## 功能与默认值

| 功能 | 默认 | 实际作用与限制 |
| --- | --- | --- |
| 自动恢复 | 开 | 对 failed/closed 或缺失的链路按游戏角色重建；自动恢复缺失链路前先等待 20 秒；每个队友额外自动尝试最多 5 次，脚本操作间隔至少 15 秒；游戏原生重试另外计算；稳定打开 15 秒后重置计数 |
| 手动恢复 | 按钮 | 对 failed/closed 或缺失的链路重建；不会重建健康链路；不会恢复已结束的房间或整局进度 |
| 刷新 TURN | 按钮 | 通过游戏自己的后端获取 ICE 配置，提供给之后新建的连接；不强行中断健康链路 |
| IPv6 过滤 | 关 | 实验功能，过滤 IPv6 字面量中继地址和发出的完整 SDP 中的 IPv6 候选；可能降低可连通性 |
| 提高中继发送频率 | 关 | 绕过游戏针对中继的隔帧发送判断；不取消独立的积压保护，可能增加带宽和拥塞 |
| 跳过 pagehide 离房 | 关 | 替换已注册的离房回调；不能阻止浏览器/手机系统冻结后台，刷新和关页时也可能延迟离房 |
| 复制诊断 | 按钮 | 不含房间码、玩家姓名、IP、SDP、账号和 ICE 凭证 |

两端均更新到 1.3.0 后，会为每轮连接协商加上临时标记，忽略迟到的旧答复及旧重置信号，减少重建时再次卡住的情况。仍兼容未更新的队友，但旧端无法提供完整的过期信令保护。

两端安装有助于各自恢复；单端恢复能否成功取决于发起方向和对端状态。slot 较小的一方会发送一次仅重置该连接的 `bye`，促使对方按原生流程重新发送 offer；这不是退房。游戏已自带 `hurryPoll()`，本工具保留它的快速轮询，只对较慢的调度设置上限。

## 指标怎么理解

- RTT：游戏测得的往返时间。
- 空闲：距离最近一次接收数据的秒数。
- 接收停顿：最近约 30 个一秒采样中，空闲超过阈值的比例。**不是丢包率，也不是快照丢帧率。**
- 积压：本机发送端的游戏缓冲指标；单凭它不能判断是对方上传不足。
- 中继：数据经 TURN 转发；不能据此断定网络一定差。更高发送频率也不保证更稳定。

## 开发与检查

需要 Node.js 22+。运行脚本本身不需要 Node.js 或任何第三方运行时库。

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run check:upstream
```

`node harness.mjs` 仍可运行离线回归检查。浏览器检查使用本地自编页面和原生 Chromium WebRTC；上游检查只读公开源码并比较接口特征，不运行或保存游戏 bundle。另有 `npm run test:protocol`（下载公开原生类，在本地服务器测试）和 `npm run test:official`（仅使用自备的两个测试账号）。已在官方服务器完成单机双上下文的进房、移动同步、回房和第二局测试；各层验证的边界见 [验证记录](docs/VALIDATION.md)。

## 控制台接口

```js
__pbCoopFix.diagnostics()          // 脱敏报告，可用于 issue
__pbCoopFix.repairNow()            // 手动恢复失败链路
await __pbCoopFix.refreshIce()     // 更新未来连接使用的 ICE 配置
__pbCoopFix.cfg.autoRepair = false
__pbCoopFix.save()                 // 保存设置
__pbCoopFix.dispose()              // 恢复钩子、移除面板；允许重新注入
```

`stats` 和 `events` 是本机调试对象，可能包含游戏对象引用或本地信息；**不要把整个对象上传到 issue**，请使用 `diagnostics()`。

卸载管理器中的脚本后刷新页面即可停止以后注入。`dispose()` 停止当前实例；保留保存在 localStorage 中的个人设置。

## 其他游戏能否使用

浏览器 WebRTC DataChannel 游戏可以复用诊断方法、重试限制和可撤销钩子的设计；自动重连需要适配房间状态、信令、连接发起权和生命周期。WebSocket 游戏需要另一种传输适配，原生客户端游戏不能直接用此油猴脚本。当前没有通用修复模式。见 [适配说明](docs/ADAPTERS.md)。

## 反馈与许可

反馈请描述游戏版本、浏览器/脚本管理器版本、操作步骤、默认或实验开关，以及脱敏诊断。不要提供房间邀请码、Cookie、令牌或完整 WebRTC 日志。

本项目采用 [MIT](LICENSE)；不对游戏本身或第三方素材授予许可。
