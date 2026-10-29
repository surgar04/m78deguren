param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
# __STORAGE_POLICY__
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
    if($Operation -ne 'settings-video-probe'){throw '未知视频检查操作'}
    $values=@(ConvertFrom-Json -InputObject $ArgumentJson)
    if($values.Count -ne 1){throw '视频检查参数无效'}
    $path=[IO.Path]::GetFullPath([string]$values[0])
    $path=Assert-LocalPath $path
    # 只读 Windows 自带的媒体属性接口，不启动播放器、不安装解码器、不调用外部下载工具。
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $fileType=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
    $propertiesType=[Windows.Storage.FileProperties.VideoProperties,Windows.Storage,ContentType=WindowsRuntime]
    $asTask=@([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Length -eq 1 -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
    function Await-Result($operation,[Type]$resultType){
        $task=$asTask.MakeGenericMethod($resultType).Invoke($null,@($operation))
        if(-not $task.Wait(8000)){throw '视频元数据检查超时'}
        return $task.GetAwaiter().GetResult()
    }
    $file=Await-Result ($fileType::GetFileFromPathAsync($path)) $fileType
    $properties=Await-Result ($file.Properties.GetVideoPropertiesAsync()) $propertiesType
    ConvertTo-Json -InputObject @{width=$properties.Width;height=$properties.Height;ticks=$properties.Duration.Ticks} -Compress|Write-Output
} catch {
    ConvertTo-Json -InputObject @{failure='无法读取视频时长，请选择完整、可解码的 MP4 / WebM 视频。'} -Compress|Write-Output
    exit 1
}
