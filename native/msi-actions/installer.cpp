// 只读的 MSI 即时自定义动作。不安装驱动、不运行脚本、不创建应用数据或证书。
// 所有文件及注册表写入由 Windows Installer 标准动作执行，以保留完整事务回滚。
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <msiquery.h>
#include <shlobj.h>
#include <algorithm>
#include <cwctype>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
std::wstring TrimEnd(std::wstring value) {
    while (!value.empty() && value.back() == L'\\') value.pop_back();
    return value;
}
bool Equal(const std::wstring& left, const std::wstring& right) {
    return CompareStringOrdinal(left.c_str(), -1, right.c_str(), -1, TRUE) == CSTR_EQUAL;
}
bool Inside(const std::wstring& path, const std::wstring& root) {
    return Equal(path, root) || (path.size() > root.size() && path[root.size()] == L'\\' &&
        CompareStringOrdinal(path.c_str(), static_cast<int>(root.size()), root.c_str(), -1, TRUE) == CSTR_EQUAL);
}
// 纯词法边界可在 C/D/E 路径上测试，测试不向这些位置创建任何文件。
bool SafeSyntax(const std::wstring& path, bool restrictD) {
    if (path.size() < 4 || !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) ||
        path[1] != L':' || path[2] != L'\\' || (restrictD && towupper(path[0]) != L'D')) return false;
    size_t start = 3;
    while (start < path.size()) {
        const auto end = path.find(L'\\', start);
        const auto part = path.substr(start, end == std::wstring::npos ? end : end - start);
        if (part.empty() || part == L"." || part == L".." || part.back() == L'.' || part.back() == L' ') return false;
        if (std::any_of(part.begin(), part.end(), [](wchar_t c) { return c < 32 || std::wstring(L":<>\"|?*/").find(c) != std::wstring::npos; })) return false;
        auto stem = part.substr(0, part.find(L'.'));
        std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t c) { return static_cast<wchar_t>(towupper(c)); });
        if (stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL" ||
            (stem.size() == 4 && (stem.substr(0, 3) == L"COM" || stem.substr(0, 3) == L"LPT") && stem[3] >= L'1' && stem[3] <= L'9')) return false;
        if (end == std::wstring::npos) break;
        start = end + 1;
    }
    return true;
}
std::wstring Property(MSIHANDLE session, const wchar_t* name) {
    DWORD size = 0;
    wchar_t empty = 0;
    auto status = MsiGetPropertyW(session, name, &empty, &size);
    if (status != ERROR_MORE_DATA && status != ERROR_SUCCESS) throw std::runtime_error("MSI property read failed");
    if (size > 32760) throw std::runtime_error("MSI property too large");
    std::vector<wchar_t> buffer(static_cast<size_t>(size) + 1);
    ++size;
    if (MsiGetPropertyW(session, name, buffer.data(), &size) != ERROR_SUCCESS) throw std::runtime_error("MSI property read failed");
    return {buffer.data(), size};
}
std::wstring FullPath(const std::wstring& path) {
    std::vector<wchar_t> buffer(32768);
    const auto size = GetFullPathNameW(path.c_str(), static_cast<DWORD>(buffer.size()), buffer.data(), nullptr);
    if (!size || size >= buffer.size()) throw std::runtime_error("Invalid path");
    return TrimEnd(std::wstring(buffer.data(), size));
}
std::wstring Folder(int id) {
    wchar_t buffer[MAX_PATH]{};
    if (SHGetFolderPathW(nullptr, id | CSIDL_FLAG_DONT_VERIFY, nullptr, SHGFP_TYPE_CURRENT, buffer) != S_OK) throw std::runtime_error("User folder unavailable");
    return FullPath(buffer);
}
bool RuntimePresent() {
    constexpr auto key = L"SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    for (const auto root : {HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER}) {
        for (const auto view : {RRF_SUBKEY_WOW6464KEY, RRF_SUBKEY_WOW6432KEY}) {
            wchar_t value[256]{}; DWORD size = sizeof(value);
            if (RegGetValueW(root, key, L"pv", RRF_RT_REG_SZ | view, nullptr, value, &size) == ERROR_SUCCESS && value[0] && std::wstring(value) != L"0.0.0.0") return true;
        }
    }
    return false;
}
UINT Fail(MSIHANDLE session, const wchar_t* message) noexcept {
    const auto record = MsiCreateRecord(0);
    if (record) { MsiRecordSetStringW(record, 0, message); MsiProcessMessage(session, INSTALLMESSAGE_ERROR, record); MsiCloseHandle(record); }
    return ERROR_INSTALL_FAILURE;
}
bool ValidTarget(const std::wstring& path) {
    wchar_t restriction[8]{};
    GetEnvironmentVariableW(L"ZHENJING_RESTRICT_WRITES_TO_D", restriction, 8);
    if (!SafeSyntax(path, std::wstring(restriction) == L"1")) return false;
    const auto full = FullPath(path);
    wchar_t windows[MAX_PATH]{};
    if (!GetWindowsDirectoryW(windows, MAX_PATH)) return false;
    for (const auto& denied : {FullPath(windows), Folder(CSIDL_COMMON_APPDATA), Folder(CSIDL_PROGRAM_FILES), Folder(CSIDL_LOCAL_APPDATA) + L"\\Zhenjing"})
        if (Inside(full, denied)) return false;
    for (const auto& denied : {Folder(CSIDL_PROFILE), Folder(CSIDL_LOCAL_APPDATA), Folder(CSIDL_APPDATA)})
        if (Equal(full, denied)) return false;
    // 逐级查已有祖先，拒绝联接/符号链接；不先创建目录来“验证”用户输入。
    for (auto current = full; current.size() > 3;) {
        const auto flags = GetFileAttributesW(current.c_str());
        if (flags != INVALID_FILE_ATTRIBUTES && (flags & FILE_ATTRIBUTE_REPARSE_POINT)) return false;
        if (flags == INVALID_FILE_ATTRIBUTES && GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND) return false;
        current = current.substr(0, current.find_last_of(L'\\'));
    }
    const auto flags = GetFileAttributesW(full.c_str());
    if (flags == INVALID_FILE_ATTRIBUTES) return true;
    if (!(flags & FILE_ATTRIBUTE_DIRECTORY)) return false;
    wchar_t id[128]{}, format[16]{};
    const auto marker = full + L"\\zhenjing-install.ini";
    GetPrivateProfileStringW(L"Application", L"Id", L"", id, 128, marker.c_str());
    GetPrivateProfileStringW(L"Application", L"Format", L"", format, 16, marker.c_str());
    if (std::wstring(id) == L"dev.zhenjing.desktop" && std::wstring(format) == L"msi") return true;
    WIN32_FIND_DATAW entry{};
    const auto find = FindFirstFileW((full + L"\\*").c_str(), &entry);
    if (find == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_FILE_NOT_FOUND;
    bool empty = true;
    do { if (std::wstring(entry.cFileName) != L"." && std::wstring(entry.cFileName) != L"..") { empty = false; break; } } while (FindNextFileW(find, &entry));
    FindClose(find);
    return empty;
}
}

extern "C" __declspec(dllexport) UINT __stdcall ValidateInstallDirectory(MSIHANDLE session) noexcept {
    try {
        if (!ValidTarget(Property(session, L"INSTALLDIR"))) return Fail(session, L"请选择本地磁盘中的独立空目录，或臻境 MSI 已登记的目录。不能使用磁盘根、系统/数据目录及目录联接。旧 EXE 安装版请先卸载，保留用户数据后再安装 MSI。");
        if (!RuntimePresent()) return Fail(session, L"需要 Microsoft Edge WebView2 运行时。请从微软官方网站安装运行时后重试；此安装器不会自动安装系统组件。");
        return ERROR_SUCCESS;
    } catch (...) { return Fail(session, L"无法确认安装目录安全性，未继续安装。请检查目录权限和路径长度。"); }
}

#ifdef ZHENJING_INSTALLER_TEST
int wmain() {
    for (const auto* path : {L"D:\\应用\\臻境", L"C:\\Users\\Other User\\Programs\\Zhenjing", L"E:\\Games\\臻境"})
        if (!SafeSyntax(path, false)) return 1;
    for (const auto* path : {L"C:\\", L"D:relative", L"\\\\server\\share", L"D:\\a\\..\\Windows", L"D:\\a:stream", L"D:\\NUL.txt", L"D:\\trailing. ", L"D:\\a/other"})
        if (SafeSyntax(path, false)) return 2;
    if (SafeSyntax(L"C:\\Users\\Example", true) || !SafeSyntax(L"D:\\应用\\臻境", true)) return 3;
    if (!Inside(L"D:\\Data\\Child", L"D:\\Data") || Inside(L"D:\\Database", L"D:\\Data")) return 4;
    return 0;
}
#endif
