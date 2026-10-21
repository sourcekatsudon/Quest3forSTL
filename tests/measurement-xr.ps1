. (Join-Path $PSScriptRoot 'measurement-lib.ps1')
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
MoveXR .25 1.5 -.4
ControlClick 'Measure'
Check 'measurement mode opens with models locked' ((Mode).active)
$p=(Values (State) 'Transform').position
$null=Iw 'ecs' 'pause';$null=Iw 'ecs' 'snapshot' @{label='measure-fixed-before'};$null=Iw 'ecs' 'step' @{count=8;delta=.016};$null=Iw 'ecs' 'snapshot' @{label='measure-fixed-after'};$null=Iw 'ecs' 'diff' @{from='measure-fixed-before';to='measure-fixed-after'}|ConvertTo-Json -Depth 10|Set-Content artifacts/measurement-freeze-diff.json;$null=Iw 'ecs' 'resume'
Check 'measurement body is stationary and gravity-free' ((Values (State) 'PhysicsBody').state-eq'KINEMATIC'-and(Values (State) 'PhysicsBody').gravityFactor-eq 0)
MoveXR $p[0] $p[1] $p[2];Grip 1;MoveXR ($p[0]+.12) $p[1] $p[2]
$fixed=Values (State) 'Transform'
Check 'native grip cannot move or grab a model during measurement' ([Math]::Abs($fixed.position[0]-$p[0])-lt .001-and @((State).components.componentId)-notcontains'Grabbed')
Grip 0;MoveXR .25 1.5 -.4
Aim @{x=-.03;y=1.55;z=-.55}
Check 'laser hit becomes red on the model' ((Mode).hit)
$null=Iw 'xr' 'select' @{device='controller-right';duration=.2}
Check 'first selected point starts the dimension' ((Mode).stage-eq'end')
Aim @{x=.03;y=1.55;z=-.55};$null=Iw 'xr' 'select' @{device='controller-right';duration=.2}
Check 'second point leaves a persistent dimension' ((Lines).total-eq 1-and(Mode).stage-eq'done')
$dimension=@(Dimensions)[0]
Check 'surface points measure 60 mm in original units' ([Math]::Abs($dimension.millimetres-60)-lt .5)
MoveXR .25 1.5 -.4
ControlClick 'MeasureAdd' $true
Check 'Add starts another dimension without removing the previous line' ((Mode).stage-eq'ready'-and(Lines).total-eq 1)
$null=Iw 'xr' 'set-input-mode' @{mode='hand'}
# Native IWER open-hand fingertip offset, measured from the SDK joint pose.
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=.003625;y=1.485786;z=-.45};duration=.3}
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=.003625;y=1.485786;z=-.517539};duration=.3}
Check 'real fingertip contact selects first point without pinching' ((Mode).stage-eq'end')
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=.003625;y=1.485786;z=-.45};duration=.3}
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=.063625;y=1.485786;z=-.45};duration=.3}
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=.063625;y=1.485786;z=-.517539};duration=.3}
Check 'second fingertip contact adds a second line' ((Lines).total-eq 2)
$second=@(Dimensions)[-1]
Check 'finger contact measures 60 mm' ([Math]::Abs($second.millimetres-60)-lt 1)
$null=Iw 'xr' 'animate-to' @{device='hand-right';position=@{x=.25;y=1.5;z=-.35};duration=.3}
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
MoveXR .25 1.5 -.4
ControlClick 'Measure'
Check 'leaving mode restores native grabbing and retains lines' (!(Mode).active-and(Lines).total-eq 2)
MoveXR $p[0] $p[1] $p[2];Grip 1
Check 'model can be grabbed again after measuring' (@((State).components.componentId)-contains'Grabbed')
MoveXR ($p[0]+.12) $p[1] $p[2];Grip 0
Check 'measurements retain real millimetres after moving the model' (@(Dimensions|Where-Object {[Math]::Abs($_.millimetres-60)-gt 1}).Count-eq 0)
MoveXR .25 1.5 -.4
ControlClick 'Measure';ControlClick 'MeasureReset' $true
Check 'measurement Reset removes every line and rearms start selection' ((Lines).total-eq 0-and(Mode).stage-eq'ready')
@{passed=$true;checks=$checks;controllerDimension=$dimension;fingerDimension=$second;physicalDeviceTested=$false}|ConvertTo-Json -Depth 8|Set-Content artifacts/measurement-results.json

