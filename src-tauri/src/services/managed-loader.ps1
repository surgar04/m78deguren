# 此路径和摘要由 Rust 从编译期组件清单注入，不读取可伪造的环境变量或用户配置。
function Initialize-ZhenjingManaged {
    if($script:ZhenjingManagedLoaded){return}
    $path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__MANAGED_PATH_BASE64__'))
    $guard=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try{
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$actual=([BitConverter]::ToString($sha.ComputeHash($guard))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
        if($actual -cne '__MANAGED_SHA256__'){throw '已安装的 Windows DLL 校验失败，请修复或重新安装臻境'}
        Add-Type -Path $path
        # 句柄伴随宿主进程存活，禁止等待 UAC/执行期间替换组件。
        $script:ZhenjingManagedGuard=$guard;$script:ZhenjingManagedLoaded=$true
    }catch{$guard.Dispose();throw}
}
