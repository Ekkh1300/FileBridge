; ─────────────────────────────────────────────────────────────────────────────
;  FileBridge — Windows installer (Inno Setup 6/7)
;  Build:  "C:\Program Files\Inno Setup 7\ISCC.exe" installer\filebridge.iss
;  Output: release\FileBridge-Setup-v<version>.exe
; ─────────────────────────────────────────────────────────────────────────────
#define AppName        "FileBridge"
#define AppVersion     "0.1.0"
#define AppPublisher   "Ekkh1300"
#define AppExeName     "FileBridge.exe"
#define AppUrl         "https://github.com/Ekkh1300/FileBridge"

[Setup]
AppId={{8B1D2C7A-6E4F-4C2E-9A1B-3D5F7C9E2A10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
OutputDir=..\release
OutputBaseFilename=FileBridge-Setup-v{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
MinVersion=10.0

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
en.DesktopIcon=Create a &desktop shortcut
en.LaunchApp=Launch {#AppName} after installation
en.DeleteData=Do you also want to delete the received files and the local database?
en.DeleteDataTitle=Delete local data?

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "launchapp";  Description: "{cm:LaunchApp}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "..\release\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md";        DestDir: "{app}"; DestName: "README.md"; Flags: ignoreversion isreadme
Source: "..\LICENSE";          DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}";             Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Comment: "Transfer files, text and clipboard between your phone and PC"
Name: "{group}\{#AppName} README";      Filename: "{app}\README.md"; Comment: "How to use FileBridge"
Name: "{group}\Uninstall {#AppName}";   Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";       Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent runascurrentuser

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
{ Ask before wiping the data folder (received files + local database). }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Answer: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    { The data folder sits next to the exe (portable) or in %LOCALAPPDATA%. }
    DataDir := ExpandConstant('{app}\FileBridge Data');
    if not DirExists(DataDir) then
      DataDir := ExpandConstant('{localappdata}\FileBridge');
    if DirExists(DataDir) then
    begin
      if UninstallSilent then
        Answer := IDNO
      else
        Answer := MsgBox(ExpandConstant('{cm:DeleteData}'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2);
      if Answer = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;

procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel2.Caption :=
    'This will install {#AppName} on this computer.' + #13#10 + #13#10 +
    'It is a local-only transfer app: your phone connects over your own Wi-Fi by scanning a QR code.' + #13#10 +
    'No account, no cloud, no internet required.';
end;
