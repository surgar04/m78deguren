$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
# Compile and run only our bounded D3D11 test window. No injection, driver or system changes.
$output=Join-Path $projectRoot '.cache\verification\hud-render.exe'
$object=Join-Path $projectRoot '.cache\verification\hud-render.obj'
& (Join-Path $projectRoot '.tools\msvc\bin\cl.exe') /nologo /std:c++20 /utf-8 /W4 /WX /O2 /MT /EHsc (Join-Path $projectRoot 'native\hud-tests\render.cpp') ('/Fo'+$object) ('/Fe'+$output) /link /SUBSYSTEM:WINDOWS D3D11.Lib DXGI.Lib User32.Lib
if($LASTEXITCODE -ne 0){throw 'HUD renderer build failed'}
& (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\verify-hud-game.ts')
if($LASTEXITCODE -ne 0){throw 'HUD automatic game / ETW test failed'}
