; Explorer's "Open With" for every photo format Playroom reads, with the
; document icons from scripts/doc-icons.mjs (shipped as resources\doc-icons
; by `win.extraResources`). Included by `nsis.include` in electron-builder.yml.
;
; electron-builder's own `fileAssociations` would write each extension's
; default ProgId, which makes Playroom the default app wherever the user has
; not picked one. Here Playroom only registers ProgIds and adds them to each
; extension's OpenWithProgids, so it is offered and never chosen for them.
; Per user (HKCU), like the one-click install.
;
; Untested on Windows: see .github/RELEASING.md.

!define PLAYROOM_CLASSES "Software\Classes"
!define PLAYROOM_APP "${PLAYROOM_CLASSES}\Applications\${APP_EXECUTABLE_FILENAME}"

; A ProgId per format: its name, icon and how to open it.
!macro playroomProgId FMT ICON DESC
  WriteRegStr HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.${FMT}" "" "${DESC}"
  WriteRegStr HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.${FMT}\DefaultIcon" "" "$INSTDIR\resources\doc-icons\${ICON}.ico"
  WriteRegStr HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.${FMT}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

; An extension offers the format's ProgId, and the app lists the extension.
!macro playroomExt EXT FMT
  WriteRegStr HKCU "${PLAYROOM_CLASSES}\.${EXT}\OpenWithProgids" "PixlPlayroom.${FMT}" ""
  WriteRegStr HKCU "${PLAYROOM_APP}\SupportedTypes" ".${EXT}" ""
!macroend

!macro playroomUnExt EXT FMT
  DeleteRegValue HKCU "${PLAYROOM_CLASSES}\.${EXT}\OpenWithProgids" "PixlPlayroom.${FMT}"
  DeleteRegKey /ifempty HKCU "${PLAYROOM_CLASSES}\.${EXT}\OpenWithProgids"
!macroend

; Every extension and its format, for installing (playroomExt) and removing
; (playroomUnExt).
!macro playroomExtensions MACRO
  !insertmacro ${MACRO} cr2 RAW
  !insertmacro ${MACRO} cr3 RAW
  !insertmacro ${MACRO} crw RAW
  !insertmacro ${MACRO} arw RAW
  !insertmacro ${MACRO} srf RAW
  !insertmacro ${MACRO} sr2 RAW
  !insertmacro ${MACRO} nef RAW
  !insertmacro ${MACRO} nrw RAW
  !insertmacro ${MACRO} raf RAW
  !insertmacro ${MACRO} rw2 RAW
  !insertmacro ${MACRO} orf RAW
  !insertmacro ${MACRO} pef RAW
  !insertmacro ${MACRO} srw RAW
  !insertmacro ${MACRO} mrw RAW
  !insertmacro ${MACRO} 3fr RAW
  !insertmacro ${MACRO} iiq RAW
  !insertmacro ${MACRO} erf RAW
  !insertmacro ${MACRO} kdc RAW
  !insertmacro ${MACRO} x3f RAW
  !insertmacro ${MACRO} dng DNG
  !insertmacro ${MACRO} jpg JPG
  !insertmacro ${MACRO} jpeg JPG
  !insertmacro ${MACRO} tif TIFF
  !insertmacro ${MACRO} tiff TIFF
  !insertmacro ${MACRO} heic HEIC
  !insertmacro ${MACRO} heif HEIC
  !insertmacro ${MACRO} png PNG
  !insertmacro ${MACRO} webp WEBP
  !insertmacro ${MACRO} avif AVIF
  !insertmacro ${MACRO} jxl JXL
!macroend

!macro customInstall
  ; .pixl is Playroom's own project file: Playroom is its default app.
  !insertmacro playroomProgId PIXL pixl "Pixl Playroom project"
  WriteRegStr HKCU "${PLAYROOM_CLASSES}\.pixl" "" "PixlPlayroom.PIXL"
  WriteRegStr HKCU "${PLAYROOM_CLASSES}\.pixl" "Content Type" "application/vnd.pixl.project"
  !insertmacro playroomExt pixl PIXL
  !insertmacro playroomProgId RAW raw "Camera RAW image"
  !insertmacro playroomProgId DNG dng "DNG image"
  !insertmacro playroomProgId JPG jpg "JPEG image"
  !insertmacro playroomProgId TIFF tiff "TIFF image"
  !insertmacro playroomProgId HEIC heic "HEIF image"
  !insertmacro playroomProgId PNG png "PNG image"
  !insertmacro playroomProgId WEBP webp "WebP image"
  !insertmacro playroomProgId AVIF avif "AVIF image"
  !insertmacro playroomProgId JXL jxl "JPEG XL image"
  WriteRegStr HKCU "${PLAYROOM_APP}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PLAYROOM_APP}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro playroomExtensions playroomExt
  ; SHCNE_ASSOCCHANGED: Explorer rereads the associations and the icons.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro playroomExtensions playroomUnExt
  !insertmacro playroomUnExt pixl PIXL
  ReadRegStr $0 HKCU "${PLAYROOM_CLASSES}\.pixl" ""
  StrCmp $0 "PixlPlayroom.PIXL" 0 +2
    DeleteRegValue HKCU "${PLAYROOM_CLASSES}\.pixl" ""
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.PIXL"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.RAW"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.DNG"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.JPG"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.TIFF"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.HEIC"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.PNG"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.WEBP"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.AVIF"
  DeleteRegKey HKCU "${PLAYROOM_CLASSES}\PixlPlayroom.JXL"
  DeleteRegKey HKCU "${PLAYROOM_APP}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
