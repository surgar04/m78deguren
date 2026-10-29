# ECP Windows displayed-frame collector

## 臻境集成说明

以下保留上游构建说明。臻境当前 MSI 为 Windows x64，仅嵌入 `native/hardware-monitor/Hud/Collector/ECPFrames-x64.exe`；其 SHA256 在迁入的 `FrameRateBackend.cs` 中固定。新增架构必须提供对应二进制、哈希和实际验收，不能根据上游支持情况推断本项目已经支持。

此采集器只负责 HUD 的显示器／指定窗口方案；游戏 FPS 和 Low 统计复用 Rust ETW。MIT 来源与原文见根目录 `THIRD_PARTY_NOTICES.md` 及 `src-tauri/resources/licenses/ECPFrames-MIT.txt`。重新编译时使用本项目 D 盘工具链与临时目录，禁止全局安装或改写开发机 C 盘。

The vendored ETW decoder is Intel PresentMon v2.6.0 (MIT), fetched from https://github.com/GameTechDev/PresentMon/tree/v2.6.0 . vendor files are unchanged; vendor-sha256.json records their hashes.

prepare.py creates a private build copy. It replaces the upstream general logging/exception/pacing support with Support.hpp, and adds one output-only CompletedWindow field before upstream clears Hwnd. Frame timestamp decoding and tracking remain upstream. ReportedPresentIds preserves actual output/layer attribution. No refresh-rate estimates or process-wide guesses are substituted for selected-window FPS.

ECPFrames.cpp emits actual displayed timestamps (QPC seconds), process ID, root HWND, swap chain, VidPn source and layer. Dropped/lost/repeated frames are omitted. Multiple windows of one process remain independent. An unavailable HWND/source remains unavailable.

One reader is shared by every HUD. --owner watches the app process; owner death stops the owned ETW session. Managed shutdown also stops the exact named session before terminating the reader.

Build with Visual Studio C++ tools, a current Windows SDK, and Python 3:

    build.cmd path-to-python.exe

Build the ARM64 helper with the MSVC ARM64 cross tools and libraries installed:

    build.cmd path-to-python.exe arm64

Both helpers use a static CRT. Copy build/ECPFrames-<architecture>.exe to Assets/PresentMon/ and update the corresponding SHA256 in FrameRateBackend.CollectorFor after rebuilding. ECP selects the helper by OS architecture: x64 Windows launches the x64 reader, and ARM64 Windows launches the ARM64 reader, including when the app itself is emulated. 32-bit Windows reports unsupported capture. Packaged ECP remains one EXE; both helpers are embedded and extracted with SHA256 verification.

Tests: official ETL replay, administrator live D3D11 two-window attribution, and automatic trace cleanup when the parent exits.
