---
title: "VMware Workstation Pro 26H1u1 上手：下载、汉化与新建 Windows 虚拟机"
published: 2026-10-11
description: "一条龙照抄版——官方下载（认准 Build 25688693）、3 步把界面换成中文、新建 Windows 虚拟机的全程向导，外加 6 个新手最容易踩的坑。"
tags: [虚拟机, VMware, Windows, 软件]
category: "技术"
---

本文是一条龙流程：**下载 → 安装 →（可选）换中文 → 新建 Windows 虚拟机**，每一步都写清了点哪里、选什么。基于 **26H1u1（Build 25688693）**，免费版即可。

## 3 分钟速览

| 要做的事 | 怎么做 | 关键点 |
| --- | --- | --- |
| 下载 | 打开 Broadcom 支持门户 | 免费、无需密钥；认准 **Build 25688693** |
| 换中文 | 语言包 `zh_CN` 丢进安装目录的 `messages`，再改一行配置或加启动参数 | 官方已无中文，语言文件来自 17.6.4，三步且可回退 |
| 装 Win11 | `Ctrl + N` → 选 ISO → 选 `Windows 11 x64` → 生成加密密码 | 自动加 vTPM，**密码丢了虚拟机就废了** |

> [!IMPORTANT] 三条铁律
> ① 安装包只从官网下，第三方镜像必须验数字签名；② Windows 11 虚拟机的加密密码当场记进密码管理器；③ 系统装完第一件事是**装 VMware Tools + 拍快照**。

## 一、下载安装包

### 1. 打开官方下载页

Workstation Pro 只在 Broadcom 支持门户分发，免费版也走同一个入口：

<https://support.broadcom.com/group/ecx/productdownloads?subfamily=VMware%20Workstation%20Pro&freeDownloads=true>

### 2. 注册 / 登录

没有 Broadcom 账号就先免费注册（邮箱即可），登录后回到这个页面。

### 3. 选版本、下载

- 版本选 **26H1u1**，Windows 取 `.exe`，Linux 取 `.bundle`。
- 页面上会标注 Build 号，**26H1u1 = 25688693**，对一眼再下，避免拿到旧包。
- 授权状态：个人、教育、商用**全部免费**，不需要许可证密钥。

> [!TIP] 下载慢 / 打不开怎么办
> 官网慢很正常，用浏览器自带下载或支持断点续传的工具即可。门户偶尔打不开时，社区有把官方安装包原样转存的仓库（例如 [201853910/VMwareWorkstation](https://github.com/201853910/VMwareWorkstation)），但下完必须验签：右键安装包 → `属性` → `数字签名` → 签名者是 Broadcom / VMware 且显示「有效」。

> [!WARNING] 别用「绿色版 / 免安装版 / 破解整合版」
> 这个软件已经免费，改过的包没有任何使用价值，只有风险。

### 4. 双击安装

顺序是固定的，一路「下一步」即可：

以管理员身份运行 → 接受许可协议 → 选择安装位置（可改，默认放 C 盘）→ 用户体验设置（不想参加改进计划就取消勾选）→ 快捷方式与命令行工具 → 安装 → 完成（部分机器会要求重启）。

### 5. 装之前对照一下硬件

| 项目 | 官方要求 | 实际建议 |
| --- | --- | --- |
| 内存 | 最低 2 GB，推荐 4 GB 以上 | 想流畅跑 Windows 11，主机 **16 GB 起步** |
| 磁盘 | 安装本身约 **2.5 GB** | 每台虚拟机再留 60–100 GB，放 **SSD** |
| CPU | 支持硬件虚拟化 | BIOS / UEFI 里要打开 **Intel VT-x / AMD-V** |
| 系统 | Windows 或 Linux | 支持列表见 Broadcom 知识库 [文章 80807](https://knowledge.broadcom.com/external/article?legacyId=80807) |

## 二、把界面换成中文（3 步）

**为什么得自己动手**：26H1u1 官方只提供英语、法语、日语、西班牙语。自 25H2 改用日历版本号起，Broadcom 移除了中文等多国语言，**最后一个自带简体中文的版本是 17.6.4**。所谓「中文补丁」，就是把旧版官方语言文件导入新版使用。

### 第 1 步：下载语言包

社区项目：**Kuroba-Sayuki/VMware-Workstation-Chinese-Localization**

<https://github.com/Kuroba-Sayuki/VMware-Workstation-Chinese-Localization>

打开仓库页 → `Code` → `Download ZIP`，解压后**只需要**里面的 `VMware Workstation Messages/zh_CN` 这一个目录。

用之前先核对文件是否完整，`zh_CN` 里必须有这三个文件：

```text
vmappsdk-zh_CN.dll
vmui-zh_CN.dll
vmware.vmsg
```

> [!WARNING] 语言包的授权与版本限制
> 该仓库自述「无开源许可证、禁止二次分发，仅作学习与存档使用」，别拿它做整合包往外发。仓库标注 **26H1 已测试可用**；26H1u1 未单独声明，升级后自己看一眼界面是否正常变中文即可（不影响功能）。

### 第 2 步：把 zh_CN 放进安装目录

1. 完全退出 VMware Workstation，**包括托盘里的常驻图标**。
2. 找到安装目录：右键桌面快捷方式 → `属性` → `目标`，路径就是安装位置。默认大概率是 `C:\Program Files\VMware\VMware Workstation`（17.x 时代是 `C:\Program Files (x86)\VMware\VMware Workstation`）。
3. 进到里面的 `messages` 文件夹，**先整份复制一份改名备份**（例如 `messages_bak`）。
4. 把整个 `zh_CN` 文件夹复制进 `messages`。

### 第 3 步：让它以中文启动（三选一）

三种方案功能完全一样，只有首页标题显示不同：

| 方案 | 做法 | 首页标题显示 |
| --- | --- | --- |
| **A（推荐）** | 编辑 `%APPDATA%\VMware\preferences.ini`，加一行 `pref.locale = "zh_CN"` | Workstation Pro 17 |
| **B** | 右键快捷方式 → `属性` → `目标`，在引号结尾**空一格**后追加 `--locale zh_CN` | Workstation Pro 17 |
| **C** | 同 B，但改成 `--locale zh_CN.`（结尾多一个点） | Workstation Pro 25H2 |

方案 B / C 的目标栏最终长这样（注意引号后面有一个空格）：

```text
"C:\Program Files\VMware\VMware Workstation\vmware.exe" --locale zh_CN
```

`preferences.ini` 追加的内容：

```ini
pref.locale = "zh_CN"
```

改完重启 Workstation，界面就是中文了。

### 效果、限制与回退

- **回退**：删掉 `messages\zh_CN`，再去掉上面那行配置或那个启动参数，就回到官方英文界面，不留残留。
- **已知限制**：26H1 新增的界面（生命周期时间戳、文件夹备注、ARM ESXi 连接）不在 17.6.4 的语言文件里，这些地方会显示英文，属正常现象。
- **升级后可能失效**：每次更新 Workstation 后重做第 2 步即可，建议把 `zh_CN` 单独留一份。
- 想更完整，可以顺带把仓库里的 VMware Tools、VGAuth 的 `zh_CN` / `zh_TW` 语言文件也装上。

> [!NOTE] 关于一键「汉化助手」
> 论坛上有一键工具，原理多半也是释放语言文件 + 改快捷方式。但它是闭源压缩包 / 可执行程序，内容无法核对；上面这套手动流程三步就能完成且随时可退，建议手动来。

## 三、新建一台 Windows 虚拟机

### 准备

- Windows 安装镜像（ISO），从微软官方渠道下载。
- 预留磁盘空间（建议 80–100 GB，放 SSD）。
- 想好分给虚拟机多少内存和 CPU，**不要超过主机的一半**。
- 装 Windows 11 的话：准备一个加密密码（向导里可以直接「生成」）。

### 走一遍新建向导

按 `Ctrl + N` 打开向导，逐页对照下表：

| 向导页面 | 怎么选 | 说明 |
| --- | --- | --- |
| 配置类型 | **典型** | 只问基础项，够用；要指定磁盘类型、物理磁盘、预分配空间才选「自定义」 |
| 安装来源 | **安装程序光盘映像文件 (iso)** → 选中你的 ISO | 也可选「稍后安装操作系统」先建空盘 |
| 客户机操作系统 | `Windows 11 x64` | 选它之后 Workstation 会自动加 vTPM |
| 名称与位置 | 自己起名，位置选非系统盘 | 位置定了就别乱挪，后面所有文件都在这个目录 |
| 加密与密码 | 「仅加密支持 vTPM 所需的最少文件」+ 勾选记住密码 | **这一步最关键，密码丢了虚拟机打不开** |
| 磁盘大小 | **80–100 GB**，选「拆分成多个文件」 | 向导默认 60 GB，低于 Windows 11 官方最低的 64 GB |
| 自定义硬件 | 内存、处理器、网络、显示器（3D 加速） | 至少点进去看一眼，默认值通常偏小 |
| 完成 | 勾选「创建后开启此虚拟机」 | 创建完自动进入装系统环节 |

### 网络模式怎么选

| 模式 | 行为 | 什么时候用 |
| --- | --- | --- |
| **NAT** | 借主机 IP 上网，外部看不到虚拟机 | 默认，最省事 |
| 桥接 | 虚拟机像另一台物理机接入局域网，有独立 IP | 要跑服务、要被局域网访问 |
| 仅主机 | 只能和主机通信，不能上网 | 隔离测试 |
| 自定义 / LAN 区段 | 手动指定虚拟网络 | 多台虚拟机组网做实验 |

### 装系统

- **简易安装（Easy Install）**：ISO 被识别后，Workstation 替你填好序列号（可留空）、用户名、密码、时区，无人值守装完。
- **手动安装**：正常的 Windows 装机流程——选版本 → 分区（直接用整块虚拟盘）→ 等待。
- Windows 11 的 TPM / Secure Boot 检查由 Workstation 代劳；万一仍提示不满足，去虚拟机设置里确认 **vTPM** 与 **UEFI Secure Boot** 都已启用。

### 装完必做 3 件事

1. **装 VMware Tools**：菜单 `虚拟机` → `安装 VMware Tools`，Windows 里会挂上一个虚拟光驱，进去运行安装程序。装了才有分辨率自适应、主机与虚拟机互拖文件、复制粘贴、共享文件夹、更好的显卡网卡驱动。
2. 打系统更新、装常用软件。
3. **拍快照**：`虚拟机` → `快照` → `拍摄快照`，命名「干净系统」。以后折腾坏了直接回滚，比备份省事得多。

## 四、新手最容易踩的 6 个坑

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| 提示虚拟化被占用 / 虚拟机很卡 | 主机开了 Hyper-V、WSL2、Windows 沙盒或内存完整性（VBS），和 Workstation 抢底层虚拟化 | 按需关掉这些功能，或接受 Workstation 走 Windows Hypervisor Platform 兼容模式（能用，性能打折） |
| Windows 11 提示不满足 TPM 2.0 | 虚拟机没启用 vTPM | 虚拟机设置里打开 vTPM（会同时要求加密） |
| 拖拽、共享文件夹不生效 | VMware Tools 没装或版本旧 | 重装 / 更新 VMware Tools |
| 虚拟磁盘只涨不降 | 虚拟盘按需增长，客户机里删文件不会立刻回收 | 设置 → 磁盘 → `清理磁盘`（压缩）后才真正释放 |
| 加密密码忘了 | 密码存在系统「凭据管理器」里，丢了打不开虚拟机 | 生成密码时立刻记进密码管理器 |
| 官网下载很慢或打不开 | 门户在境外 | 换时间段 / 网络；用镜像站必须验数字签名 |

## 五、版本信息速查

| 项目 | 值 |
| --- | --- |
| 版本 | 26H1u1（26H1 的 Update 1） |
| 发布日期 | 2026-09-03 |
| Build | 25688693 |
| 平台 | Windows（x64）、Linux |
| 授权 | 免费，无需许可证密钥 |
| 官方界面语言 | 英语、法语、日语、西班牙语（**无中文**） |

**26H1 的关键变化**：Windows 版整体转为 **64 位应用**；新增虚拟机生命周期时间戳（创建 / 最后开机时间）、文件夹标签页备注、凭据管理器条目更清晰；支持连接 ARM 架构 ESXi（技术预览）；新增 Ubuntu 26.04 LTS、Fedora 43 & 44、SLE 16 / openSUSE 16.0、FreeBSD 15.0 等客户机支持。

**26H1u1 修了什么**（纯修复，无新功能）：自动修复 Secure Boot 平台密钥（PK）失效问题；修复 **CVE-2026-59346、CVE-2026-59347**（详见 [VMSA-2026-0007](https://support.broadcom.com/web/ecx/support-content-notification/-/external/content/SecurityAdvisories/0/38288)）；修掉托盘菜单不本地化、客户机关屏后抓不到输入、硬件加速下虚拟机画面缩成缩略图三个问题。

> [!NOTE] PK 更新的前提
> 启用 vTPM 的 Windows 虚拟机要吃到 PK 更新，客户机需装 VMware Tools 13.1.5 及以上，并且先打上 2026 年 7 月或更新的 Windows 累积更新。

**官方来源**：[26H1u1 发行说明](https://techdocs.broadcom.com/us/en/vmware-cis/desktop-hypervisors/workstation-pro/26H1/release-notes/vmware-workstation-pro-26h1u1-release-notes.html) · [26H1 发布公告](https://blogs.vmware.com/cloud-foundation/2026/05/14/announcing-vmware-workstation-and-fusion-26h1/) · [新建 Windows 11 虚拟机官方步骤](https://techdocs.broadcom.com/us/en/vmware-cis/desktop-hypervisors/workstation-pro/26H1/using-vmware-workstation-pro/creating-virtual-machines-in-workstation-user-guide/create-a-new-virtual-machine-on-the-local-host/install-windows-11-on-a-virtual-machine-in-workstation.html)

---

新装直接拿 **26H1u1**；在用 26H1 / 25H2 的建议升级，两个 CVE 的修复在里面。下载只认 Broadcom 门户，中文按上面三步换、随时可退，新建虚拟机全程和十年前几乎一样——唯一变复杂的是 Windows 11 带来的 vTPM 与加密，密码记得收好。
