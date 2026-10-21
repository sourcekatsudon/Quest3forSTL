. (Join-Path $PSScriptRoot 'quest-v2-lib.ps1')
$model=[int](Iw 'ecs' 'find' @{withComponents=@('RoomModel');limit=8}).entities[-1].entityIndex
$inputs=(Iw 'ecs' 'find' @{namePattern='Room input';limit=2}).entities
function InputModes {
 foreach($item in $inputs){(Values (Iw 'ecs' 'query' @{entityIndex=$item.entityIndex;components=@('RoomInputVisuals')}) 'RoomInputVisuals').mode}
}
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
Check 'both sides automatically display controllers' (@(InputModes | Where-Object {$_ -eq 'controller'}).Count -eq 2)
$null=Iw 'xr' 'set-input-mode' @{mode='hand'}
Check 'both sides automatically display tracked hands' (@(InputModes | Where-Object {$_ -eq 'hand'}).Count -eq 2)
$state=State;$p=(Values $state 'Transform').position
$null=Iw 'xr' 'set-select-value' @{device='hand-right';value=0}
# Measured IWER hand grip offset in its pinched pose, over the left GLB block.
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=$p[0]-.062;y=$p[1]+.003;z=$p[2]-.037};duration=.3}
$null=Iw 'xr' 'set-select-value' @{device='hand-right';value=1}
Check 'pinch still grabs model with ghost visible' (@((State).components.componentId) -contains 'Grabbed')
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=.18;y=1.5;z=-.6};duration=.3}
$null=Iw 'xr' 'set-select-value' @{device='hand-right';value=0}
Check 'release preserves gravity-off placement' ((Values (State) 'PhysicsBody').state -eq 'KINEMATIC' -and @((State).components.componentId) -notcontains 'Grabbed')
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
Check 'picking up controllers switches back without restart' (@(InputModes | Where-Object {$_ -eq 'controller'}).Count -eq 2)
$null=Iw 'xr' 'set-input-mode' @{mode='hand'}
$null=Iw 'xr' 'animate-to' @{device='hand-left';position=@{x=-.18;y=1.5;z=-.6};duration=.3}
Check 'putting down controllers restores hand mode' (@(InputModes | Where-Object {$_ -eq 'hand'}).Count -eq 2)
@{passed=$true;checks=$checks;runtime='IWER Meta Quest 3';physicalDeviceTested=$false}|ConvertTo-Json -Depth 5|Set-Content artifacts/hand-ghost-results.json
