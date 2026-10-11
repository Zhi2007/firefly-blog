---
title: VMware Workstation Pro 26H1u1 上手：下载、汉化与新建 Windows 虚拟机
published: 2026-10-11
description: 26H1u1 是 Broadcom 目前最新的桌面虚拟机版本，免费、全 64 位，但官方已经不再提供中文。这篇记录三件事：怎么从官网拿到安装包、怎么用社区语言包换回中文界面、以及从零新建一台 Windows 虚拟机的完整步骤。
tags: [虚拟机, VMware, Windows, 软件]
category: 折腾
---

## 先说结论

- Workstation Pro 依然是 Windows 上最省心的桌面虚拟机方案，而且**免费**了：个人、教育、商用都不再需要许可证密钥。
- **26H1u1** 是 26H1 的安全更新（2026-09-03 发布，Build 25688693），修了两个 CVE。在用 26H1 / 25H2 的建议直接升。
- 官方**已经不再提供简体中文界面**（只剩英、法、日、西），想要中文只能自己导入语言包。本文给的是可回退的手动方案，不碰来历不明的一体包。
- 安装包只从 Broadcom 支持门户下载（需要注册一个免费账号）。

## 一、这个版本是什么

VMware Workstation Pro 是在一台机器上同时跑多个 x86 操作系统（Windows、Linux……）的桌面虚拟化软件，做系统测试、软件兼容性验证、隔离环境、给别人演示环境都很方便。被 Broadcom 收购后它换了版本号规则：不再叫 17.x，改成日历版本（25H2 = 2025 下半年，26H1 = 2026 上半年），`u1` 表示该版本的第一个更新。

| 项目 | 值 |
| --- | --- |
| 版本 | 26H1u1（26H1 的 Update 1） |
| 发布日期 | 2026-09-03 |
| Build | 25688693 |
| 平台 | Windows（x64）、Linux |
| 授权 | 免费，无需许可证密钥 |
| 官方界面语言 | 英语、法语、日语、西班牙语（**无简体中文**） |

### 26H1 带来的变化

26H1 是一次架构级更新，最值得说的一条是 **Windows 版整体变成 64 位应用**，二进制、库、安装组件都以 64 位进程运行，摆脱了 32 位遗留组件，大内存场景下更稳。其余的新东西偏「顺手」：

- **虚拟机生命周期时间戳**：库里直接看到每台虚拟机的创建时间和最后一次开机时间，方便清理临时环境。
- **文件夹标签页备注**：虚拟机备注直接显示在文件夹页签上。
- **凭据管理器更清楚**：加密虚拟机和远程服务器的凭据在系统凭据管理器里更容易辨认。
- **可连接 ARM 架构 ESXi 主机**（技术预览）。
- **新的客户机/主机系统支持**：Ubuntu 26.04 LTS、Fedora 43 & 44、SUSE Linux Enterprise 16、openSUSE 16.0、FreeBSD 15.0 等。

### 26H1u1 修了什么

这个小版本没有新功能，是安全与缺陷修复：

- **自动修复 Secure Boot 平台密钥（PK）**：针对 `VMW.NULLPK` 无效、微软 Secure Boot 证书过期的问题，提供「静默 PK 更新」（ESXi 场景）和「Capsule PK 更新」（不影响依赖 TPM 的应用，适用于启用了 vTPM 的 Windows 虚拟机）两条路径。
- 修复 **CVE-2026-59346、CVE-2026-59347**，详见 [VMSA-2026-0007](https://support.broadcom.com/web/ecx/support-content-notification/-/external/content/SecurityAdvisories/0/38288)。
- 修了三个日常问题：法语/西语系统下托盘右键菜单仍是英文；客户机自动关闭显示器后 Workstation 抓不到输入、唤不醒；开启「为所有虚拟机启用硬件加速」后，在 Home 与 My Computer 页签之间切换会让虚拟机画面缩成左上角缩略图。

> 注意：Capsule PK 更新依赖客户机里的 VMware Tools 13.1.5 及以上版本；Windows 客户机还需要先打上 2026 年 7 月或更新的累积更新，PK 更新驱动才装得进去。

官方信息来源：[26H1u1 发行说明](https://techdocs.broadcom.com/us/en/vmware-cis/desktop-hypervisors/workstation-pro/26H1/release-notes/vmware-workstation-pro-26h1u1-release-notes.html)、[26H1 发布公告](https://blogs.vmware.com/cloud-foundation/2026/05/14/announcing-vmware-workstation-and-fusion-26h1/)。

## 二、安装包怎么下载

### 官方渠道（唯一推荐）

Workstation Pro 只在 Broadcom 支持门户分发，免费版也走同一个入口：

<https://support.broadcom.com/group/ecx/productdownloads?subfamily=VMware%20Workstation%20Pro&freeDownloads=true>

流程：

1. 打开上面的链接，没有 Broadcom 账号就先免费注册（邮箱即可），登录。
2. 在 VMware Workstation Pro 的下载列表里选择 **26H1u1**，按平台取 Windows 安装包（`.exe`）或 Linux 安装包（`.bundle`）。
3. 勾选同意条款后下载。下载页会同时给出该版本对应的 Build 号，**26H1u1 应为 25688693** —— 装之前对一眼，能避免下到旧包。
4. 官网速度慢是常见现象，用浏览器自带下载或下载工具的断点续传就行。

Windows 安装大致是：右键「以管理员身份运行」→ 接受许可协议 → 选择安装位置 → 用户体验设置（是否参加客户体验改进计划，随手取消即可）→ 是否创建快捷方式 / 命令行工具 → 安装 → 完成（部分环境需要重启）。

### 关于第三方镜像

门户偶尔打不开，社区确实有把官方安装包原样搬到 GitHub 的仓库（例如 [201853910/VMwareWorkstation](https://github.com/201853910/VMwareWorkstation)）。用这类镜像只有一条铁律：**下完先验签**——右键安装包 → 属性 → 数字签名，确认签名者是 Broadcom / VMware 且显示「有效」；对不上就直接删。所谓「绿色版」「免安装版」「破解整合版」一律不要碰，这个软件已经免费，没有任何理由用改过的包。

### 装之前看一眼硬件

- 官方最低内存要求是 **2 GB**，推荐 4 GB 以上；安装本身大约占 **2.5 GB** 磁盘空间，之后每台虚拟机还要单独留空间（官方建议每台客户机至少 1 GB，实际按系统要求来）。
- CPU 需要支持硬件虚拟化（Intel VT-x / AMD-V），并且要在 BIOS / UEFI 里打开。
- 主机系统支持 Windows 和 Linux，具体支持列表见 Broadcom 知识库 [文章 80807](https://knowledge.broadcom.com/external/article?legacyId=80807)。
- 实际体验：想在虚拟机里舒服地跑 Windows 11，主机 **16 GB 内存**起步比较合适，虚拟磁盘放 SSD。

## 三、把界面换回中文

### 为什么得自己动手

26H1u1 的发行说明里「Internationalization」一节列得很清楚，官方只提供英语、法语、日语、西班牙语。自 25H2 改用日历版本号起，Broadcom 移除了包括中文在内的多国语言支持，**最后一个官方自带简体中文的版本是 17.6.4**。所以这里的「中文补丁」，本质是把旧版本的官方语言文件导入新版本使用。

### 语言包从哪来

社区项目 **Kuroba-Sayuki/VMware-Workstation-Chinese-Localization**：

<https://github.com/Kuroba-Sayuki/VMware-Workstation-Chinese-Localization>

关于它，有几件事要先讲明白：

- 语言文件**提取自官方 17.6.4 版**（`VMware-Workstation-Full-17.6.4-24832109`）。
- 仓库描述写明「**26H1 已测试可用**」；26H1u1 未单独声明，升级后请自己验证（界面能正常变中文即可，不影响功能）。
- 仓库自己写了：**无开源许可证、禁止二次分发，仅作学习与存档使用**。所以别拿它做整合包往外发。
- 下载方式：打开仓库页 → `Code` → `Download ZIP`；如果只想动手，也可以只取里面的 `VMware Workstation Messages/zh_CN` 目录。网上有网盘转存（例如[这篇博客园的汉化教程](https://www.cnblogs.com/ykj521/p/23129150)里给了一个），但尽量走 GitHub 原仓库，第三方转存要自己核对文件是否完整。

`zh_CN` 目录里应该有这三个文件，缺一个都别用：

```text
vmappsdk-zh_CN.dll
vmui-zh_CN.dll
vmware.vmsg
```

### 安装步骤

1. 完全退出 VMware Workstation，包括托盘里的常驻进程。
2. 找到安装目录下的 `messages` 文件夹。26H1 起应用是 64 位，路径大概率在 `C:\Program Files\VMware\VMware Workstation\messages`；17.x 时代是 `C:\Program Files (x86)\VMware\VMware Workstation\messages`。以你机器上的实际安装位置为准（快捷方式 → 属性 → 目标 就能看到）。**动手前先把原来的 `messages` 整个复制一份改名备份**。
3. 把整个 `zh_CN` 文件夹复制进 `messages`。
4. 三选一启用中文（区别只在首页标题显示什么，功能没差别）：

| 方案 | 做法 | 首页标题显示 |
| --- | --- | --- |
| A（推荐） | 编辑 `%APPDATA%\VMware\preferences.ini`，加入一行 `pref.locale = "zh_CN"` | Workstation Pro 17 |
| B | 右键快捷方式 → 属性 → 目标，在引号结尾后**空一格**追加 `--locale zh_CN` | Workstation Pro 17 |
| C | 同 B，但追加 `--locale zh_CN.`（结尾多一个点） | Workstation Pro 25H2 |

5. 重新启动 Workstation，界面就是中文了。

方案 B / C 的目标栏正确格式长这样：

```text
"C:\Program Files\VMware\VMware Workstation\vmware.exe" --locale zh_CN
```

### 会踩到的坑，提前说清

- **新功能没有翻译**。26H1 新增的时间戳、文件夹备注、ARM ESXi 连接等界面在 17.x 的语言文件里根本不存在，这些地方会回落成英文，属正常现象。
- **翻译上下文可能对不上**。语言文件反映的是 17.6.4 时代的界面，个别措辞与新版界面对不上。
- **每次升级 Workstation 后可能失效**，重做第 3 步即可；也建议升级前把 `zh_CN` 单独留一份。
- 想要更完整的中文，可以顺带把仓库里的 VMware Tools、VGAuth 的 `zh_CN` / `zh_TW` 语言文件也装上（作用是虚拟机内的 Tools 界面）。
- **回退方法**：删掉 `messages\zh_CN`，再删掉 `preferences.ini` 里那一行，或者去掉快捷方式后面的启动参数，就回到官方英文界面，不留残留。

### 关于「一键汉化助手」

论坛上确实有一键工具（比如 52pojie 上那类《VMware Workstation 汉化助手》），原理多半也是释放语言文件加改快捷方式。但它是闭源的压缩包 / 可执行程序，来源和内容没法核对。既然上面这套流程三步就能完成，还随时能回退，我个人的建议是手动来。

## 四、新建一台 Windows 虚拟机

### 0. 准备

- Windows 安装镜像（ISO）：微软官方渠道下载。Windows 11 官方要求 TPM 2.0 + Secure Boot，**不需要改造 ISO**，Workstation 会自动给虚拟机加 vTPM。
- 想清楚虚拟机放哪块盘、留多少空间；建议放 SSD。
- 内存和 CPU 别超过主机的一半，主机还要用。

### 1. 走一遍新建向导

1. `文件` → `新建虚拟机`（`Ctrl + N`）。
2. 选配置类型：
   - **典型**：只问基础项，绝大多数情况够用；
   - **自定义**：要指定硬件兼容性版本、磁盘类型（IDE / SCSI / SATA / NVMe）、用物理磁盘、预先分配全部空间等，才需要它。
3. 安装来源选**「安装程序光盘映像文件 (iso)」**并指向 Windows ISO。也可以选「稍后安装操作系统」先建空盘。
4. 选择客户机操作系统：`Windows 10 x64` 或 `Windows 11 x64`。**选 Windows 11 时 Workstation 会自动加入 vTPM，并要求对虚拟机加密**，这是官方设计的正常流程。
5. 填虚拟机名称、选择存放位置。
6. （Windows 11 才会出现）加密选项与密码：可选「仅加密支持 vTPM 所需的最少文件」，密码可以点「生成」并勾选记住——Windows 主机把密码存进「凭据管理器」。**这个密码别丢**，丢了虚拟机打不开。
7. 磁盘大小：向导默认 60 GB，而 Windows 11 官方最低要求 64 GB，建议直接给 80～100 GB；磁盘文件建议选「拆分成多个文件」。
8. 点「自定义硬件」至少看一眼：内存、处理器核心数、网络模式、USB 控制器、声卡、打印机、显示器（3D 加速）。
9. 勾选「创建后开启此虚拟机」→ `完成`。

### 2. 网络模式怎么选

| 模式 | 行为 | 什么时候用 |
| --- | --- | --- |
| NAT | 借主机 IP 上网，外部看不到客户机 | 默认选项，最省事 |
| 桥接 | 客户机像另一台物理机接入局域网，有独立 IP | 需要被局域网访问、要在虚拟机里跑服务 |
| 仅主机 | 只能和主机通信，不能上网 | 隔离测试 |
| 自定义 / LAN 区段 | 手动指定虚拟网络 | 多台虚拟机组网做实验 |

### 3. 装系统

- 如果 ISO 被识别，会自动进入**简易安装（Easy Install）**：Workstation 替你填好序列号（可留空）、用户名、密码、时区，然后无人值守装完。
- 没走简易安装就是正常的 Windows 安装流程：选版本 → 分区（直接用整块虚拟盘）→ 等待。
- Windows 11 的 TPM / Secure Boot 检查由 Workstation 代劳；万一还是提示不满足，去虚拟机设置里确认 vTPM 与 UEFI Secure Boot 都已启用。

### 4. 装完必做的三件事

1. **装 VMware Tools**：菜单 `虚拟机` → `安装 VMware Tools`，Windows 里会挂上一个虚拟光驱，进去运行安装程序。装了才有分辨率自适应、主机与虚拟机之间拖拽和复制粘贴、共享文件夹、更好的显卡/网卡驱动和时间同步。
2. 打系统更新、装常用软件。
3. **拍第一个快照**：`虚拟机` → `快照` → `拍摄快照`，命名成「干净系统」。以后折腾坏了直接回滚，比备份省事得多。

### 5. 常见问题

- **提示硬件虚拟化被占用 / 性能很差**：Windows 主机上装了 Hyper-V、WSL2、Windows 沙盒，或开了内存完整性（VBS）后，会和 Workstation 抢底层虚拟化。要么按需关掉这些功能，要么接受 Workstation 走 Windows Hypervisor Platform 兼容模式（能用，但性能打折）。
- **拖拽、共享文件夹不生效**：先确认 VMware Tools 已安装且是最新版本。
- **虚拟磁盘越来越大**：虚拟盘是按需增长的，客户机里删了文件，还要在 Workstation 的 `虚拟机设置 → 磁盘 → 清理磁盘` 里压缩，空间才会真正还回来。

## 五、一句话总结

新装就直接拿 **26H1u1**，已经在用 26H1 / 25H2 的也建议升，两个 CVE 的修复在里面。下载只认 Broadcom 门户，中文靠社区语言包三步搞定、随时可退，新建虚拟机的流程和十年前几乎一样——唯一变复杂的是 Windows 11 带来的 vTPM 与加密，密码记得收好。
