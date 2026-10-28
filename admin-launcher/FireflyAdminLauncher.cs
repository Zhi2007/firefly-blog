// 栀海博客 · 本地管理面板桌面启动器
//
// 作用：把原先「一个 cmd 窗口跑 node + 一个浏览器标签页」合并成一个窗口：
//   1. 后台用隐藏的 node 子进程运行 admin/server.mjs（不弹黑框）；
//   2. 用 Chrome / Edge 的 --app 模式打开面板（无标签栏 / 地址栏，独立窗口）；
//   3. 子进程的 stdout / stderr 写进 logs/admin-server.log，面板「后台」页可直接查看；
//   4. 关掉面板窗口 = 结束 node 子进程；面板里点「重启后台」时自动重新拉起（端口 / 令牌不变）。
//
// 只依赖 Windows 自带的 .NET Framework 4.x 编译器（见 build.cmd），不需要 Node 之外的任何运行时。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Cache;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace FireflyAdminLauncher
{
    internal sealed class Options
    {
        public string RepoRoot;
        public bool SelfTest;
        public bool NoBrowser;

        public static Options Parse(string[] args)
        {
            var options = new Options();
            options.RepoRoot = AppDomain.CurrentDomain.BaseDirectory;
            foreach (var arg in args)
            {
                if (string.Equals(arg, "--selftest", StringComparison.OrdinalIgnoreCase))
                {
                    options.SelfTest = true;
                }
                else if (string.Equals(arg, "--no-browser", StringComparison.OrdinalIgnoreCase))
                {
                    options.NoBrowser = true;
                }
                else if (arg.StartsWith("--root=", StringComparison.OrdinalIgnoreCase))
                {
                    options.RepoRoot = arg.Substring("--root=".Length);
                }
            }
            options.RepoRoot = Path.GetFullPath(options.RepoRoot);
            return options;
        }
    }

    internal static class Paths
    {
        public static string FindNode()
        {
            var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (var dir in path.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var candidate = Path.Combine(dir.Trim(), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
            };
            foreach (var candidate in candidates)
            {
                if (!string.IsNullOrEmpty(candidate) && File.Exists(candidate)) return candidate;
            }
            return null;
        }

        public static string FindBrowser()
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var candidates = new[]
            {
                Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
            };
            foreach (var candidate in candidates)
            {
                if (!string.IsNullOrEmpty(candidate) && File.Exists(candidate)) return candidate;
            }
            return null;
        }

        public static int FindFreePort(int preferred)
        {
            for (var port = preferred; port < preferred + 30; port++)
            {
                if (IsPortFree(port)) return port;
            }
            throw new InvalidOperationException("找不到可用端口（8799-8828 都被占用了）。");
        }

        private static bool IsPortFree(int port)
        {
            var listener = new TcpListener(IPAddress.Loopback, port);
            try
            {
                listener.Start();
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
            finally
            {
                try { listener.Stop(); } catch { }
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            var options = Options.Parse(args);
            if (options.SelfTest)
            {
                using (var launcher = new Launcher(options))
                {
                    return launcher.RunSelfTest();
                }
            }

            bool created;
            using (var mutex = new Mutex(true, @"Local\FireflyAdminLauncher", out created))
            {
                if (!created)
                {
                    MessageBox.Show(
                        "管理面板已经在运行了。\n\n如果没看到窗口，请检查任务栏；或先在旧窗口里关闭面板再重试。",
                        "栀海博客 · 管理面板",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return 0;
                }
                Application.EnableVisualStyles();
                try
                {
                    using (var launcher = new Launcher(options))
                    {
                        launcher.Run();
                    }
                    return 0;
                }
                catch (Exception error)
                {
                    MessageBox.Show(
                        "启动失败：\n\n" + error.Message,
                        "栀海博客 · 管理面板",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                    return 1;
                }
            }
        }
    }

    internal sealed class Launcher : IDisposable
    {
        private static readonly Encoding Utf8NoBom = new UTF8Encoding(false);
        private static readonly string SelfTestResultPath =
            Path.Combine(Path.GetTempPath(), "firefly_admin_launcher_selftest.txt");

        private readonly Options options;
        private readonly string repoRoot;
        private readonly string nodePath;
        private readonly string serverPath;
        private readonly string logPath;
        private readonly string token;
        private readonly int port;
        private readonly object gate = new object();
        private readonly object logGate = new object();
        private readonly ManualResetEvent exitEvent = new ManualResetEvent(false);

        private Process server;
        private Process browser;
        private System.Threading.Timer restartTimer;
        private volatile bool shuttingDown;
        private volatile bool restartEnabled;
        private int restartAttempts;

        public Launcher(Options options)
        {
            this.options = options;
            repoRoot = options.RepoRoot;
            serverPath = Path.Combine(repoRoot, "admin", "server.mjs");
            if (!File.Exists(serverPath))
            {
                throw new InvalidOperationException(
                    "找不到 admin\\server.mjs。\n请把启动器放在博客仓库根目录（与 admin 文件夹同级）。");
            }
            nodePath = Paths.FindNode();
            if (nodePath == null)
            {
                throw new InvalidOperationException(
                    "没有找到 Node.js。\n请先安装 Node.js（https://nodejs.org/），或把它加入 PATH。");
            }
            port = Paths.FindFreePort(8799);
            token = Guid.NewGuid().ToString("N");
            logPath = Path.Combine(repoRoot, "logs", "admin-server.log");
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
        }

        // ── 启动 / 主循环 ────────────────────────────────────────────────

        public void Run()
        {
            PrepareLog();
            if (!StartServerBlocking())
            {
                ShowError("后台启动失败：\n\n" + TailLog(3000));
                Shutdown();
                return;
            }

            if (options.SelfTest)
            {
                RunSelfTestInternal();
                return;
            }

            if (!options.NoBrowser && !StartBrowser())
            {
                Shutdown();
                return;
            }

            exitEvent.WaitOne();
        }

        // ── 后台进程 ────────────────────────────────────────────────────

        private bool StartServerBlocking()
        {
            lock (gate)
            {
                if (shuttingDown) return false;
                DisposeServer();
                AppendLog("---- 启动后台 ----");
            }

            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + serverPath + "\" --no-open --port=" + port,
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                info.EnvironmentVariables["ADMIN_TOKEN"] = token;
                info.EnvironmentVariables["ADMIN_SUPERVISED"] = "1";
                info.EnvironmentVariables["ADMIN_PORT"] = port.ToString();

                var process = new Process { StartInfo = info, EnableRaisingEvents = true };
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) AppendLog(e.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) AppendLog(e.Data);
                };
                process.Exited += delegate { OnServerExited(); };
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                lock (gate) { server = process; }

                if (!WaitForReady(TimeSpan.FromSeconds(60)))
                {
                    AppendLog("---- 后台在 60 秒内没有就绪 ----");
                    KillTree(process);
                    return false;
                }

                restartEnabled = true;
                restartAttempts = 0;
                AppendLog("---- 后台已就绪：http://127.0.0.1:" + port + "/ ----");
                return true;
            }
            catch (Exception error)
            {
                AppendLog("---- 启动后台失败：" + error.Message + " ----");
                return false;
            }
        }

        private void OnServerExited()
        {
            if (shuttingDown || !restartEnabled) return;
            AppendLog("---- 后台进程已退出，启动器准备重启 ----");
            lock (gate)
            {
                if (shuttingDown) return;
                if (restartTimer != null) restartTimer.Dispose();
                restartTimer = new System.Threading.Timer(RestartServer, null, 600, Timeout.Infinite);
            }
        }

        private void RestartServer(object state)
        {
            lock (gate)
            {
                if (shuttingDown) return;
                restartAttempts++;
            }
            AppendLog("---- 第 " + restartAttempts + " 次重启后台 ----");
            if (StartServerBlocking()) return;
            if (restartAttempts >= 5)
            {
                ShowError("后台连续启动失败：\n\n" + TailLog(3000));
                Shutdown();
                return;
            }
            lock (gate)
            {
                if (restartTimer != null) restartTimer.Dispose();
                restartTimer = new System.Threading.Timer(RestartServer, null, 1500, Timeout.Infinite);
            }
        }

        // ── 面板窗口 ────────────────────────────────────────────────────

        private bool StartBrowser()
        {
            var browserPath = Paths.FindBrowser();
            if (browserPath == null)
            {
                ShowError("没有找到 Microsoft Edge 或 Google Chrome。\n\n面板需要这两者之一来显示窗口。");
                return false;
            }
            // 不同浏览器的 profile 格式不兼容：Chrome / Edge 各用各的子目录，避免互相锁住或迁移失败
            var browserKey = Path.GetFileNameWithoutExtension(browserPath).ToLowerInvariant();
            var profileDir = Path.Combine(repoRoot, "logs", "admin-browser-profile-" + browserKey);
            Directory.CreateDirectory(profileDir);
            var url = "http://127.0.0.1:" + port + "/?token=" + token;
            var arguments =
                "--app=" + url +
                " --user-data-dir=\"" + profileDir + "\"" +
                " --no-first-run --no-default-browser-check --disable-background-mode" +
                " --window-size=1400,950";
            AppendLog("---- 打开面板窗口：" + browserPath + " ----");
            AppendLog("---- 浏览器参数：" + arguments + " ----");
            try
            {
                var first = LaunchBrowser(browserPath, arguments);
                if (first == null) return false;
                // 某些受限环境（例如被套在沙箱 / Job Object 里）会用 STATUS_BREAKPOINT
                // 让 Chromium 的沙箱初始化失败。先正常启动；若它秒退，再降级到 --no-sandbox。
                if (!first.WaitForExit(1200))
                {
                    AttachBrowser(first);
                    return true;
                }
                var code = -1;
                try { code = first.ExitCode; } catch { }
                AppendLog("---- 面板窗口首次启动退出（code=" + code + "），尝试兼容模式 ----");
                try { first.Dispose(); } catch { }
                Thread.Sleep(350);
                // --test-type 用来抑制 Chromium 对 --no-sandbox 的「不受支持的命令行标记」提示条；
                // 只在本机回环面板上使用，不涉及外部网页浏览。
                var fallback = LaunchBrowser(browserPath, arguments + " --no-sandbox --test-type");
                if (fallback == null) return false;
                if (fallback.WaitForExit(1200))
                {
                    var fallbackCode = -1;
                    try { fallbackCode = fallback.ExitCode; } catch { }
                    AppendLog("---- 兼容模式也启动失败（code=" + fallbackCode + "） ----");
                    ShowError("面板窗口启动失败（浏览器退出码 " + fallbackCode + "）。\n\n请确认 Chrome / Edge 可以正常打开。");
                    return false;
                }
                AttachBrowser(fallback);
                return true;
            }
            catch (Exception error)
            {
                AppendLog("---- 打开面板窗口失败：" + error.Message + " ----");
                ShowError("打开面板窗口失败：\n\n" + error.Message);
                return false;
            }
        }

        private static Process LaunchBrowser(string browserPath, string arguments)
        {
            var info = new ProcessStartInfo
            {
                FileName = browserPath,
                Arguments = arguments,
                UseShellExecute = true,
                CreateNoWindow = false,
            };
            var process = Process.Start(info);
            if (process == null) throw new InvalidOperationException("浏览器进程没有启动。");
            return process;
        }

        private void AttachBrowser(Process process)
        {
            AppendLog("---- 面板窗口进程 PID：" + process.Id + " ----");
            process.EnableRaisingEvents = true;
            process.Exited += delegate
            {
                var code = -1;
                try { code = process.ExitCode; } catch { }
                AppendLog("---- 面板窗口进程已退出（PID " + process.Id + "，code=" + code + "） ----");
                Shutdown();
            };
            lock (gate) { browser = process; }
        }

        // ── 就绪检测 / HTTP ─────────────────────────────────────────────

        /// <summary>
        /// 就绪探针专用：轻量接口，只读内存状态（不跑 git、不联网、不 spawn），毫秒级。
        /// 老版本 server.mjs 没有这个接口时，WaitForReady 会自动退回 StatusUrl。
        /// </summary>
        private string HealthUrl
        {
            get { return "http://127.0.0.1:" + port + "/api/health?token=" + token; }
        }

        private string StatusUrl
        {
            get { return "http://127.0.0.1:" + port + "/api/status?token=" + token; }
        }

        private bool WaitForReady(TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow.Add(timeout);
            var attempts = 0;
            var lastError = "还没有拿到响应";
            // 先打轻量接口 /api/health（毫秒级，不跑 git / 不联网 / 不 spawn）。
            // 老版本 server.mjs 没有这个接口（404）时退回 /api/status，兼容旧仓库。
            var url = HealthUrl;
            while (DateTime.UtcNow < deadline)
            {
                if (shuttingDown) return false;
                attempts++;
                try
                {
                    var body = HttpGet(url, 5000);
                    if (body != null && body.Contains("\"supervised\":true")) return true;
                    lastError = "响应里没有 supervised:true";
                }
                catch (WebException error)
                {
                    var response = error.Response as HttpWebResponse;
                    if (response != null && (int)response.StatusCode == 404 && url != StatusUrl)
                    {
                        AppendLog("---- 服务端没有 /api/health（404），退回 /api/status 做就绪检测 ----");
                        url = StatusUrl;
                        lastError = "健康接口不存在，已退回 /api/status";
                    }
                    else
                    {
                        lastError = response != null ? ("HTTP " + (int)response.StatusCode) : error.Message;
                    }
                }
                catch (Exception error)
                {
                    lastError = error.Message;
                }
                Thread.Sleep(250);
            }
            // 探针失败时把「试了几次 + 最后一次错误」写进日志，避免下次只剩一句「没就绪」无从查起
            AppendLog("---- 就绪检测失败：尝试 " + attempts + " 次，最后错误：" + lastError + " ----");
            return false;
        }

        private static string HttpGet(string url, int timeoutMs)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Proxy = null;
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            request.CachePolicy = new RequestCachePolicy(RequestCacheLevel.NoCacheNoStore);
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static string HttpPostJson(string url, string json)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Proxy = null;
            request.Method = "POST";
            request.ContentType = "application/json; charset=utf-8";
            request.Timeout = 5000;
            request.ReadWriteTimeout = 5000;
            request.CachePolicy = new RequestCachePolicy(RequestCacheLevel.NoCacheNoStore);
            var bytes = Encoding.UTF8.GetBytes(json);
            request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream())
            {
                stream.Write(bytes, 0, bytes.Length);
            }
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        // ── 自检 ────────────────────────────────────────────────────────

        public int RunSelfTest()
        {
            PrepareLog();
            if (!StartServerBlocking())
            {
                WriteSelfTest("FAIL 后台启动失败\n" + TailLog(2000));
                Shutdown();
                return 1;
            }
            try
            {
                var first = HttpGet(StatusUrl, 10000);
                var supervised = first.Contains("\"supervised\":true");
                var firstPid = ExtractPid(first);

                HttpPostJson(StatusUrl, "{\"action\":\"restart\"}");

                string secondPid = null;
                var deadline = DateTime.UtcNow.AddSeconds(35);
                while (DateTime.UtcNow < deadline)
                {
                    Thread.Sleep(700);
                    try
                    {
                        var body = HttpGet(StatusUrl, 10000);
                        var pid = ExtractPid(body);
                        if (pid != null && pid != firstPid && body.Contains("\"supervised\":true"))
                        {
                            secondPid = pid;
                            break;
                        }
                    }
                    catch
                    {
                        // 重启窗口期，继续等
                    }
                }

                var ok = supervised && firstPid != null && secondPid != null;
                WriteSelfTest(
                    (ok ? "OK" : "FAIL") +
                    " supervised=" + supervised +
                    " firstPid=" + (firstPid ?? "null") +
                    " secondPid=" + (secondPid ?? "null") +
                    " port=" + port +
                    " log=" + logPath);
                return ok ? 0 : 1;
            }
            catch (Exception error)
            {
                WriteSelfTest("FAIL " + error.Message);
                return 1;
            }
            finally
            {
                Shutdown();
            }
        }

        private void RunSelfTestInternal()
        {
            // Program.Main 在 --selftest 时直接调用 RunSelfTest；这里只做防御，避免误入后挂起。
            WriteSelfTest("FAIL 自检入口异常");
            Shutdown();
        }

        private static string ExtractPid(string json)
        {
            if (json == null) return null;
            var match = Regex.Match(json, "\"pid\"\\s*:\\s*(\\d+)");
            return match.Success ? match.Groups[1].Value : null;
        }

        private void WriteSelfTest(string result)
        {
            AppendLog("SELFTEST " + result);
            try
            {
                File.WriteAllText(SelfTestResultPath, result + Environment.NewLine, Utf8NoBom);
            }
            catch
            {
                // 自检结果写不进临时目录时，只能靠退出码
            }
            try
            {
                File.WriteAllText(
                    Path.Combine(Path.GetDirectoryName(logPath), "admin-selftest.txt"),
                    result + Environment.NewLine,
                    Utf8NoBom);
            }
            catch
            {
                // 日志目录也不可写时忽略
            }
        }

        // ── 日志 / 清理 ─────────────────────────────────────────────────

        private void PrepareLog()
        {
            try
            {
                File.WriteAllText(logPath, string.Empty, Utf8NoBom);
            }
            catch
            {
                // 日志文件被占用时继续跑，AppendLog 会再尝试
            }
            AppendLog("===== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " 启动器启动 =====");
            AppendLog("仓库：" + repoRoot);
            AppendLog("命令：" + nodePath + " admin/server.mjs --no-open --port=" + port);
        }

        private void AppendLog(string line)
        {
            try
            {
                lock (logGate)
                {
                    File.AppendAllText(logPath, line + Environment.NewLine, Utf8NoBom);
                }
            }
            catch
            {
                // 日志写失败不能影响面板
            }
        }

        private string TailLog(int maxBytes)
        {
            try
            {
                var text = File.ReadAllText(logPath);
                if (text.Length <= maxBytes) return text;
                return text.Substring(text.Length - maxBytes);
            }
            catch
            {
                return "（读取日志失败）";
            }
        }

        private void ShowError(string message)
        {
            if (options.SelfTest) return;
            try
            {
                MessageBox.Show(message, "栀海博客 · 管理面板", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch
            {
                // 没有可用桌面时忽略
            }
        }

        private void Shutdown()
        {
            lock (gate)
            {
                if (shuttingDown) return;
                shuttingDown = true;
                if (restartTimer != null)
                {
                    restartTimer.Dispose();
                    restartTimer = null;
                }
            }
            AppendLog("---- 关闭后台 ----");
            DisposeServer();
            try
            {
                if (browser != null && !browser.HasExited) browser.Kill();
            }
            catch
            {
                // 已退出
            }
            exitEvent.Set();
        }

        private void DisposeServer()
        {
            Process process;
            lock (gate)
            {
                process = server;
                server = null;
            }
            if (process == null) return;
            try
            {
                if (!process.HasExited) KillTree(process);
            }
            catch
            {
                // 忽略
            }
            try { process.Dispose(); } catch { }
        }

        private static void KillTree(Process process)
        {
            if (process == null) return;
            try
            {
                if (process.HasExited) return;
                var info = new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = "/PID " + process.Id + " /T /F",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                using (var killer = Process.Start(info))
                {
                    if (killer != null) killer.WaitForExit(4000);
                }
            }
            catch
            {
                try { if (!process.HasExited) process.Kill(); } catch { }
            }
        }

        public void Dispose()
        {
            Shutdown();
            exitEvent.Dispose();
        }
    }
}
