!macro customInstall
  ; Check if birda CLI is available on PATH.
  ; We cannot rely on SearchPath alone because the installer process may have
  ; a stale PATH (e.g. birda was installed moments ago but Explorer has not
  ; picked up the WM_SETTINGCHANGE broadcast yet).  To work around this we
  ; also read the *current* system and user PATH values straight from the
  ; registry and search every listed directory for birda.exe.

  StrCpy $1 ""  ; will be set to the found path, or left empty

  ; --- attempt 1: the normal SearchPath (process environment) ---
  SearchPath $0 "birda.exe"
  ${If} $0 != ""
    StrCpy $1 $0
  ${EndIf}

  ; --- attempt 2: walk the registry PATH entries ---
  ${If} $1 == ""
    ; Read system PATH
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    StrCpy $2 $0  ; $2 = system PATH

    ; Read user PATH and append
    ReadRegStr $0 HKCU "Environment" "Path"
    ${If} $0 != ""
      ${If} $2 != ""
        StrCpy $2 "$2;$0"
      ${Else}
        StrCpy $2 $0
      ${EndIf}
    ${EndIf}

    ; Walk each ;-separated directory in $2
    ${Do}
      ; Extract token before first semicolon
      StrCpy $3 ""   ; current dir token
      StrCpy $4 0    ; char index
      ${Do}
        StrCpy $5 $2 1 $4          ; one char at offset $4
        ${If} $5 == ""
          ; end of string – last token
          StrCpy $3 $2
          StrCpy $2 ""
          ${ExitDo}
        ${ElseIf} $5 == ";"
          StrCpy $3 $2 $4          ; chars before semicolon
          IntOp $4 $4 + 1
          StrCpy $2 $2 "" $4       ; remainder after semicolon
          ${ExitDo}
        ${EndIf}
        IntOp $4 $4 + 1
      ${Loop}

      ; Skip empty tokens
      ${If} $3 != ""
        ${If} ${FileExists} "$3\birda.exe"
          StrCpy $1 "$3\birda.exe"
          ${ExitDo}
        ${EndIf}
      ${EndIf}

      ; Nothing left to parse
      ${If} $2 == ""
        ${ExitDo}
      ${EndIf}
    ${Loop}
  ${EndIf}

  ; --- show prompt only if both methods failed ---
  ${If} $1 == ""
    MessageBox MB_YESNO|MB_ICONINFORMATION \
      "Birda GUI requires the birda CLI tool to function.$\r$\n$\r$\nbirda was not found on your system PATH.$\r$\n$\r$\nWould you like to open the download page?" \
      IDYES openDownload IDNO skipDownload
    openDownload:
      ExecShell "open" "https://github.com/tphakala/birda/releases"
    skipDownload:
  ${EndIf}
!macroend
