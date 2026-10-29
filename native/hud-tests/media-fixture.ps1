$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$player=[Windows.Media.Playback.MediaPlayer,Windows.Media.Playback,ContentType=WindowsRuntime]::new()
try {
  $player.IsMuted=$true
  $player.IsLoopingEnabled=$true
  $player.Source=[Windows.Media.Core.MediaSource,Windows.Media.Core,ContentType=WindowsRuntime]::CreateFromUri([Uri]::new($env:HUD_TEST_AUDIO))
  $controls=$player.SystemMediaTransportControls
  $controls.IsEnabled=$true
  $controls.IsPlayEnabled=$true
  $controls.IsPauseEnabled=$true
  $display=$controls.DisplayUpdater
  $display.Type=[Windows.Media.MediaPlaybackType,Windows.Media,ContentType=WindowsRuntime]::Music
  $player.Play()
  $end=[DateTime]::UtcNow.AddSeconds(45)
  while([DateTime]::UtcNow -lt $end){
    $display.MusicProperties.Title=$env:HUD_TEST_TITLE
    $display.MusicProperties.Artist='Zhenjing silent fixture'
    $display.Update()
    Start-Sleep -Milliseconds 500
  }
} finally {$player.Dispose()}
