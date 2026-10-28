# 栀海博客 · 单窗口管理面板启动器

把原先「一个 cmd 窗口跑 Node + 一个浏览器标签页」合并成**一个窗口**：

- 双击仓库根目录的 **`firefly-admin.exe`**；
- Node 后台隐藏运行，不弹黑框；
- 只出现一个**无标签栏 / 无地址栏**的 Chrome（或 Edge）窗口；
- 关闭窗口 = 停止 Node，不会留下后台进程。

## 文件

| 文件 | 作用 |
| --- | --- |
| `FireflyAdminLauncher.cs` | 全部源码（C# 5 / .NET Framework WinForms，零第三方依赖） |
| `build.cmd` | 用 Windows 自带 `csc.exe` 编译到 `..\firefly-admin.exe` |
| `app.ico` | exe 图标（与站点 favicon 同一枚标记），由 `build.cmd` 通过 `/win32icon` 嵌入 |
| `app.manifest` | 视觉样式 + `asInvoker`（不请求管理员权限） |

`firefly-admin.exe` 是构建产物，已被 `.gitignore` 忽略；换机器后重新跑一次 `build.cmd` 即可。

## 使用

1. 双击仓库根目录的 `firefly-admin.exe`；
2. 等待 1–3 秒，面板窗口自动出现（首次启动会创建浏览器 profile，稍慢）；
3. 面板顶部有 **刷新界面** / **重启后台**；左侧「后台」页可以看日志、复制、打开日志文件；
4. 关闭窗口即停止后台。

## 它在背后做了什么

1. 单实例 Mutex，避免重复打开；
2. 在 PATH / 常见安装位置找 `node.exe`；
3. 从 8799 起找一个空闲端口；
4. 生成固定 `ADMIN_TOKEN`，设置 `ADMIN_SUPERVISED=1`，隐藏启动：

   ```text
   node admin\server.mjs --no-open --port=<port>
   ```

5. 轮询 `http://127.0.0.1:<port>/api/health`（轻量：只读内存状态，不跑 git / 不联网 / 不 spawn；单次 5 秒、总窗口 60 秒），确认 `supervised:true` 后再开浏览器；旧版服务端没有该接口（404）时自动退回 `/api/status`；
6. 用 Chrome / Edge 的 `--app=<带 token 的地址>` 打开面板，profile 在 `logs/admin-browser-profile-<chrome|msedge>`；
7. Node 的 stdout/stderr 实时追加到 `logs/admin-server.log`，面板「后台」页读它；
8. 面板点「重启后台」→ 服务端退出 → 启动器用**同端口 / 同 token** 重新拉起 → 页面轮询恢复后自动刷新；
9. 关闭浏览器窗口 → 启动器结束 Node 并退出。

## 重新编译 / 自检

```bat
:: 重新编译（需要 Windows 自带 .NET Framework 4.x）
admin-launcher\build.cmd

:: 自检：不打开浏览器，启动后台 → 校验托管 → 请求重启 → 等新 PID
firefly-admin.exe --selftest
:: 结果写到 logs\admin-selftest.txt；退出码 0 = 通过
```

可选参数：

- `--root=<仓库根目录>`：启动器不在仓库根目录时手动指定；
- `--no-browser`：只启动后台，不开窗口（调试用）；
- `--selftest`：见上。

## 日志与 profile

| 路径 | 内容 |
| --- | --- |
| `logs/admin-server.log` | 每次启动会清空重写；面板「后台」页读最后 128KB |
| `logs/admin-selftest.txt` | 最近一次 `--selftest` 的结果 |
| `logs/admin-browser-profile-chrome` / `-msedge` | 浏览器 profile（主题、缓存）；两种浏览器格式不兼容，必须分开 |

## 已知限制与排查

- **需要 Node.js 和 Chrome 或 Edge**；找不到时启动器会弹中文错误框。
- **不要以管理员身份运行**：启动器会检测提权并直接弹窗退出。管理员权限下浏览器会拒绝打开面板窗口（「浏览器退出码 0」），`explorer.exe` 也无法从提权进程拉起（「打开所在文件夹」失败）。正常双击即可。
- **普通桌面先带 Chromium 沙箱启动**。如果面板窗口一闪而过、日志里出现 `code=-2147483645`（`STATUS_BREAKPOINT`），启动器会自动用 `--no-sandbox --test-type` 再试一次并写日志；`--test-type` 用来隐藏 Chromium 的「不受支持的命令行标记」提示条。某些 Windows / 安全软件环境也可能触发降级，不一定是嵌套沙箱；只影响本机回环面板，不用于浏览外部网页。
- **Chrome 与 Edge 的 profile 不能共用**；分开后避免「Chrome 秒退 / Edge 白屏」。
- **后台明明起来了却提示「后台启动失败」**：看 `logs/admin-server.log` 里 `---- 就绪检测失败：尝试 N 次，最后错误：… ----`。就绪探针只打 `/api/health`（毫秒级）；如果这里还超时，多半是 node 没起来或端口被占，而不是探针本身的问题。
- 如果启动器被强杀，Node 可能残留：用任务管理器结束 `node.exe`（命令行含 `admin/server.mjs`）即可；正常关闭窗口不会残留。
