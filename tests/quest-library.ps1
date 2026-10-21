. ./tests/quest-v2-lib.ps1
$library=Find '^RoomLibrary$'
$pose=Values (Iw 'ecs' 'query' @{entityIndex=$library;components=@('Transform')}) 'Transform'
Check 'thumbnail explorer sits within the forward view' ([Math]::Abs($pose.position[0]-.6)-lt .01 -and [Math]::Abs($pose.position[2]+1.2)-lt .01)
$before=(Iw 'ecs' 'find' @{withComponents=@('RoomModel')}).total
$target=Point $library '#Item0' 0;Aim $target
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=0;value=1})}
Aim @{x=$target.x-.4;y=$target.y+.05;z=$target.z+.2}
$null=Iw 'xr' 'set-gamepad-state' @{device='controller-right';buttons=@(@{index=0;value=0})}
$models=Iw 'ecs' 'find' @{withComponents=@('RoomModel')}
Check 'drag/drop still adds one model after layout adjustment' ($models.total-eq $before+1)
& node $cli browser screenshot --output-file artifacts/quest-v2-layout-final.png|Out-Null
@{passed=$true;checks=$checks.ToArray();libraryPose=$pose;models=$models.total}|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 artifacts/quest-library-results.json
