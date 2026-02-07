!macro customInstall
  ; Check if birda CLI is available on PATH
  SearchPath $0 "birda.exe"
  ${If} $0 == ""
    MessageBox MB_YESNO|MB_ICONINFORMATION \
      "Birda GUI requires the birda CLI tool to function.$\r$\n$\r$\nbirda was not found on your system PATH.$\r$\n$\r$\nWould you like to open the download page?" \
      IDYES openDownload IDNO skipDownload
    openDownload:
      ExecShell "open" "https://github.com/tphakala/birda/releases"
    skipDownload:
  ${EndIf}
!macroend
