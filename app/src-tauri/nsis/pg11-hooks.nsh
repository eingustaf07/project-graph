!define PG11_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  File /oname=$PLUGINSDIR\pg11-import-profile.ps1 "${PG11_HOOK_DIR}\pg11-import-profile.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\pg11-import-profile.ps1" -SourceDirectory "$APPDATA\eingustaf07.project-graph-custom" -DestinationDirectory "$APPDATA\eingustaf07.project-graph-pg11"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "PG1.0 设置复制未完成，安装已停止。原版设置未修改。请关闭 Project Graph 后重试。"
    Abort
  ${EndIf}
!macroend

