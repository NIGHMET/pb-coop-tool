# 拖入油猴安装（已有油猴）

**[点击下载安装文件：pb-coop-tool-install.user.js](https://github.com/NIGHMET/pb-coop-tool/releases/download/v1.3.0-beta.2/pb-coop-tool-install.user.js)**

1. 下载上面的文件，保留 `.user.js` 后缀；不用解压、打开或复制代码。
2. 在平时玩游戏的 Edge / Chrome 中，点击油猴图标 → **管理面板** → **已安装脚本**。
3. 把下载的 `pb-coop-tool-install.user.js` **拖到管理面板页面中间**。弹出安装页后，确认名称为「PokéBonk 联机增强 / Co-op Connection Doctor」，点击 **安装**。
4. 回到 [PokéBonk](https://pokebonk.com)，刷新并进入合作房间。右下角面板显示房间及队友状态，才算接入成功。

安装必须保留油猴自己的确认步骤。这个文件就是项目现有用户脚本，不安装额外程序，也不导入其他脚本或油猴设置。

## 拖放没有反应

打开管理面板 → **实用工具** → **导入**区域的 **选择文件**，选择同一个 `.user.js` 文件，按提示确认安装。也可以使用 [在线安装入口](https://raw.githubusercontent.com/NIGHMET/pb-coop-tool/main/pb-coop-fix.user.js)。

如果油猴提示“允许用户脚本”，先按[油猴官方说明](https://www.tampermonkey.net/faq.php?q=Q209)开启对应权限，再刷新游戏。

不要拖 GitHub 的源码 ZIP 包：它不是油猴安装文件。本项目提供的安装文件后缀是 **`.user.js`**。

## 已验证的范围

2026-10-27：在独立的 Chromium 测试环境中，使用 Chrome 商店发布的 Tampermonkey **5.5.1**，拖入脚本后识别出正确名称和版本；点击安装后，脚本出现在“已安装脚本”列表。这验证了导入安装流程，未修改或验证用户本人浏览器中的安装和权限设置。

## 生成安装文件（开发者）

运行 `npm run package:installer`。输出位于 `artifacts/install/pb-coop-tool-install.user.js`，与仓库中的 `pb-coop-fix.user.js` 逐字节相同。发布该文件作为 Release 附件即可；第三方扩展代码和浏览器测试资料不属于安装包。
