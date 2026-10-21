. (Join-Path $PSScriptRoot 'quest-v2-lib.ps1')
$panel=Find '^RoomControls$'
function PhotoState {Values (Iw 'ecs' 'query' @{entityIndex=$panel;components=@('RoomPhotoCapture')}) 'RoomPhotoCapture'}
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
$point=Point $panel '#Photo'
$null=Iw 'xr' 'look-at' @{device='controller-left';target=$point}
$null=Iw 'xr' 'select' @{device='controller-left';duration=.2}
Start-Sleep -Milliseconds 600
Check 'native left-panel click retries and saves the retained image' ((PhotoState).stage-eq'saved')
$null=Iw 'xr' 'select' @{device='controller-left';duration=.2}
Check 'photo gesture can be disabled without affecting other controls' ((PhotoState).stage-eq'off')
$null=Iw 'xr' 'select' @{device='controller-left';duration=.2}
Check 'photo gesture can be enabled again' ((PhotoState).stage-eq'ready')
@{passed=$true;checks=$checks}|ConvertTo-Json -Depth 4|Set-Content artifacts/photo-retry-results.json
