$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
& "$PSScriptRoot\prepare-msi-tools.ps1"
# 仅编译和只读检查两个微型 MSI，不运行 msiexec，不创建快捷方式或注册表。
# 对照包应含 LUA bit，实际模板应不含，防止 WiX 的 InstallScope 隐式覆盖配置。
$testRoot=Join-Path $projectRoot ('.cache\verification\msi-privileges-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot)|Out-Null
$template=[xml][IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/installer/installer.wxs'))
$ns=[Xml.XmlNamespaceManager]::new($template.NameTable)
$ns.AddNamespace('w','http://schemas.microsoft.com/wix/2006/wi')
$actual=$template.SelectSingleNode('/w:Wix/w:Product/w:Package',$ns)
if(-not $actual -or $actual.GetAttribute('InstallPrivileges') -ne 'elevated' -or $actual.HasAttribute('InstallScope')){throw 'MSI 提权声明错误'}
if($template.SelectNodes('//w:Property[@Id="ALLUSERS" or @Id="DISABLEROLLBACK"]',$ns).Count){throw '不得改变用户范围或关闭回滚'}
$conditions=@($template.SelectNodes('/w:Wix/w:Product/w:Condition',$ns)|ForEach-Object{$_.InnerText})
if('NOT ALLUSERS' -notin $conditions){throw '必须禁止覆盖为全机安装'}
foreach($case in @('control','actual')){
    $package=if($case -eq 'actual'){$actual.OuterXml}else{'<Package Id="*" InstallerVersion="500" Compressed="yes" InstallScope="perUser" InstallPrivileges="limited" Platform="x64" />'}
    # 同时链接实际向导和错误提示，发现与 WixUI 标准错误表冲突时直接失败。
    $ui=if($case -eq 'actual'){
        '<Property Id="WIXUI_INSTALLDIR" Value="INSTALLDIR" />'+(@($template.SelectNodes('/w:Wix/w:Product/w:UIRef | /w:Wix/w:Product/w:UI',$ns)|ForEach-Object{$_.OuterXml}) -join '')
    }else{''}
    $payload=Join-Path $projectRoot 'src-tauri/resources/profile-seed.ini'
    $escaped=[Security.SecurityElement]::Escape($payload)
    $xml=@"
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi"><Product Id="*" Name="Privilege inspection fixture" Language="2052" Codepage="936" Version="1.0.0" Manufacturer="Test only" UpgradeCode="79D343EA-50E9-498D-AE55-8E5E1BD77304">
$package
<MediaTemplate EmbedCab="yes" />
$ui
<Condition Message="Per-user only">NOT ALLUSERS</Condition>
<Directory Id="TARGETDIR" Name="SourceDir"><Directory Id="LocalAppDataFolder"><Directory Id="INSTALLDIR" Name="NeverInstalledFixture"><Component Id="Fixture" Guid="1762D35B-7B63-4CCB-938F-54EA969AC6C5" Win64="yes"><File Id="FixtureFile" Source="$escaped"/><RegistryValue Root="HKCU" Key="Software\ZhenjingTestOnly" Name="Fixture" Value="1" Type="integer" KeyPath="yes"/></Component></Directory></Directory></Directory>
<Feature Id="Main" Level="1"><ComponentRef Id="Fixture"/></Feature>
</Product></Wix>
"@
    $source=Join-Path $testRoot ($case+'.wxs');$object=Join-Path $testRoot ($case+'.wixobj');$msi=Join-Path $testRoot ($case+'.msi')
    [IO.File]::WriteAllText($source,$xml,[Text.UTF8Encoding]::new($false))
    & (Join-Path $projectRoot '.tools/tauri-bundler/WixTools314/candle.exe') -nologo -out $object $source
    if($LASTEXITCODE -ne 0){throw 'MSI 权限样本编译失败'}
    & (Join-Path $projectRoot '.tools/tauri-bundler/WixTools314/light.exe') -nologo -sval -ext (Join-Path $projectRoot '.tools/tauri-bundler/WixTools314/WixUIExtension.dll') -cultures:zh-CN -out $msi $object
    if($LASTEXITCODE -ne 0){throw 'MSI 权限样本链接失败'}
    $metadata=Join-Path $testRoot ($case+'.json')
    & "$PSScriptRoot\inspect-msi.ps1" -Path $msi -Output $metadata
    $data=[IO.File]::ReadAllText($metadata)|ConvertFrom-Json
    $expected=if($case -eq 'control'){8}else{0}
    if(($data.wordCount -band 8) -ne $expected){throw ('实际 MSI 提权位错误：'+$case)}
    if($data.properties.PSObject.Properties.Name -contains 'ALLUSERS'){throw '实际 MSI 改变了安装范围'}
}
Write-Output ('MSI elevation checks passed (read-only; no installation): '+$testRoot)
