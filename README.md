# Get Microsoft Rewards

<div align="center">

**微软 Rewards 助手 - 自动完成搜索、活动、签到、阅读任务，配备极简 UI 悬浮窗，一键全自动获取积分。**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/QingJ/get-microsoft-rewards)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-v4.0+-orange.svg)](https://www.tampermonkey.net/)

[功能特性](#-功能特性) • [安装使用](#-安装使用) • [使用说明](#-使用说明) • [常见问题](#-常见问题)

</div>

---

## 📸 界面预览

> 极简设计，右下角悬浮窗，点击展开即可查看所有任务进度

![界面预览](<img width="385" height="554" alt="图片" src="https://github.com/user-attachments/assets/53078d01-a10f-42f8-8fe4-1b6d73adab67" />
)

*收起状态*：右下角礼盒图标，不占用视线  
*展开状态*：清晰显示等级、积分、各项任务进度

---

## ✨ 功能特性

### 🎯 核心功能
- ✅ **PC 搜索任务** - 自动完成每日 PC 端搜索（通常 90 分）
- ✅ **移动搜索任务** - 自动完成每日移动端搜索（通常 60 分）
- ✅ **每日活动** - 自动完成每日集合、促销活动任务
- ✅ **每日签到** - 自动签到获取奖励积分（需授权）
- ✅ **阅读任务** - 自动完成阅读文章任务（需授权）
- 🚀 **一键全部执行** - 点击一次，自动完成所有任务

### 🎨 界面特色
- 🎁 **悬浮窗设计** - 右下角小图标，不干扰浏览
- 📊 **实时进度** - 实时显示任务完成进度和积分
- 🌈 **极简美学** - 干净的白底设计，无多余动画
- 📝 **日志输出** - 内置日志区域，任务执行一目了然

### 🛡️ 安全特性
- 🔒 **本地运行** - 所有逻辑在浏览器本地执行
- 🎲 **随机延迟** - 模拟真实用户行为，降低风控风险
- 🌐 **热搜词库** - 使用真实热搜词，搜索更自然
- 🍪 **Cookie 隔离** - 精准控制移动/PC 搜索判定

---

## 📦 安装使用

### 前置要求
- 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/) 浏览器扩展
- Microsoft 账号（已注册 Microsoft Rewards）

### 安装步骤

1. **安装脚本管理器**
   - Chrome/Edge: [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - Firefox: [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/)

2. **安装脚本**
   - 点击 [安装链接](https://raw.githubusercontent.com/QingJ/get-microsoft-rewards/main/1.js)
   - 或手动复制 `1.js` 内容到 Tampermonkey 新建脚本

3. **访问 Bing**
   - 打开 [https://www.bing.com](https://www.bing.com) 或 [https://rewards.bing.com](https://rewards.bing.com)
   - 右下角会出现礼盒图标 🎁

---

## 🎮 使用说明

### 基础使用

1. **查看进度**
   - 点击右下角礼盒图标展开面板
   - 查看当前等级、积分、各项任务进度

2. **执行任务**
   - **搜索任务**: 点击 `🔍 搜索` 按钮
   - **活动任务**: 点击 `🎯 活动` 按钮
   - **签到任务**: 点击 `✅ 签到` 按钮（需授权）
   - **阅读任务**: 点击 `📖 阅读` 按钮（需授权）
   - **一键执行**: 点击 `🚀 一键全部执行` 按钮

3. **收起面板**
   - 点击右上角 `×` 关闭按钮

### 授权设置（签到/阅读任务）

签到和阅读任务需要 Microsoft OAuth 授权：

**方法一：通过脚本界面**

1. 点击 `✅ 签到` 或 `📖 阅读` 按钮
2. 面板会显示授权区域
3. 点击 `🔗 获取授权码` 按钮
4. 在弹出的新窗口登录微软账号
5. 登录成功后，复制跳转后的完整 URL（包含 `code=M.xxx`）
6. 粘贴到输入框，点击 `保存` 按钮
7. 再次点击签到/阅读按钮即可执行

**方法二：直接访问授权链接**

直接访问以下链接获取授权码：

👉 [点击这里获取授权码](https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf)

登录后复制跳转页面的完整 URL，粘贴到脚本面板的授权输入框即可。

> **提示**: 授权码会自动保存，下次使用无需重复授权（除非 Token 过期）

---

## 🔧 高级配置

脚本内置了合理的默认配置，一般无需修改。如需自定义，可编辑脚本中的 `CONFIG` 对象：

```javascript
const CONFIG = {
    pc: { minDelay: 15000, maxDelay: 30000 },      // PC搜索间隔（毫秒）
    mobile: { minDelay: 20000, maxDelay: 35000 },  // 移动搜索间隔（毫秒）
    hotApi: {
        enabled: true,                              // 是否启用热搜API
        url: 'https://hot.baiwumm.com/api/',
        sources: ['weibo', 'douyin', 'baidu', 'zhihu', 'toutiao']
    }
};
```

---

## ❓ 常见问题

### Q: 移动搜索显示 0/0？
**A**: 
- 如果您是 **Level 1** 用户，微软通常不提供移动搜索任务，显示 0/0 是正常的
- 如果您是 **Level 2+** 用户，脚本会尝试推断上限（通常 60 分），如仍显示 0/0，请检查账号状态

### Q: 签到/阅读任务失败？
**A**: 
1. 确认已正确获取并保存授权码
2. 检查授权码是否过期（Token 有效期约 1 小时）
3. 尝试重新获取授权码

### Q: 搜索任务没有积分？
**A**: 
- 确保在 **正确的地区**（中国大陆用户需访问 cn.bing.com）
- 检查账号是否被 **风控**（搜索过于频繁可能触发）
- 等待一段时间后再试

### Q: 脚本不显示/无法点击？
**A**: 
1. 确认已安装 Tampermonkey 并启用脚本
2. 刷新页面（Ctrl+F5 强制刷新）
3. 检查浏览器控制台是否有报错

### Q: 如何卸载？
**A**: 
- 打开 Tampermonkey 管理面板
- 找到 "Get Microsoft Rewards" 脚本
- 点击删除即可

---

## 📊 技术栈

- **核心**: 原生 JavaScript (ES6+)
- **网络请求**: `GM_xmlhttpRequest`
- **存储**: `GM_setValue` / `GM_getValue`
- **通知**: `GM_notification`
- **Cookie**: `GM_cookie`

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

---

## ⚠️ 免责声明

- 本脚本仅供学习交流使用，请勿用于商业用途
- 使用本脚本产生的任何后果由使用者自行承担
- 请遵守 Microsoft Rewards 服务条款，合理使用
- 作者不对账号封禁、积分清零等问题负责

---

## 💖 支持

如果这个项目对您有帮助，欢迎：

- ⭐ Star 本仓库
- 🐛 提交 Bug 报告
- 💡 提出新功能建议
- 📣 分享给更多人

---

<div align="center">

**Made with ❤️ by QingJ**

[⬆ 回到顶部](#get-microsoft-rewards)

</div>
