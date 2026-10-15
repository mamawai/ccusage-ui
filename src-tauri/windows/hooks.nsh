; 卸载前先把 Claude Code 的状态栏恢复原样（见 src/limits.rs 的 unhook）：
; 不然 settings.json 里的状态栏命令还指向这个马上要删掉的 exe，Claude Code 的状态栏就空了。
; 先确认程序已经关掉（在运行就照常问要不要关）：放在恢复后面的话，用户在那一步点了取消，卸载没做，状态栏却已经断开了。
; 手动装新版本时，安装包会先跑一遍旧版的卸载，这里也会恢复；新版第一次启动会重新接上
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --ccusage-ui-unhook'
!macroend
