# Attribution

本站内托管的静态版本镜像自 https://github.com/CzJam/gjgjxweb （《搞机工具箱》Web 版，作者 晨钟酱Official）。

- 原始项目：https://github.com/CzJam/gjgjxweb
- 官方在线版：https://czjam.github.io/gjgjxweb/
- 许可证：GPL-3.0-only（全文见本目录 `LICENSE`；Tango / xterm.js 的 MIT 许可见 `LICENSE-Tango.txt`、`LICENSE-xterm.txt`）
- 版权归原作者所有；本目录为**原样镜像**（只保留托管所需的 `index.html`、`css/`、`js/`、`assets/favicon.ico`
  与三份许可证，未改动任何逻辑），用于官方在线版不可访问时的站内备用入口，非商业用途。
- 与官方版唯一的运行差异在**站点侧**而不是代码：本站默认的 `Permissions-Policy` 关掉了 `usb=()`，
  而 WebUSB 正需要它，所以 `worker/index.mjs` 只对 `/tools/gjgjxweb/` 这条前缀下发 `usb=(self)`。
- 若需更新，请以官方仓库为准（镜像时对应提交 `f84f9d5`，2026-11-07）。
