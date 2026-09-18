# youtube-music-widget

YouTube Music을 위한 가벼운 데스크톱 위젯. `music.youtube.com` 페이지 자체는 로그인할 때만 잠깐 띄우고, 평소에는 `youtubei.js`로 보관함 데이터와 오디오 스트림만 가져와서 작고 컴팩트한 커스텀 UI로 보여줍니다.

## 기능

- **보관함**: 재생목록 목록 표시 (아티스트/프로필/자동 재생목록 등은 제외, 순수 재생목록만)
- **재생목록 열기**: 목록 클릭 시 트랙 목록으로 이동해서 원하는 곡 재생
- **섞어서 반복 재생**: 재생목록 항목에 마우스를 올리면 나오는 재생 버튼 — 이동 없이 그 자리에서 셔플+반복 재생 시작
- **재생 컨트롤**: 이전/재생·일시정지/다음, 클릭해서 이동 가능한 진행바, 짧은 볼륨 슬라이더 (기본 30%)
- **미니 모드**: 헤더의 `─` 버튼으로 목록을 접고 헤더+플레이어만 남는 작은 창으로 전환 (다시 누르면 복원)
- **항상 위에 고정** (📌), **새로고침** (🔄, 보관함/현재 재생목록을 다시 불러옴)
- **트레이 백그라운드 실행**: 닫기(✕) 버튼은 트레이로 숨김, 트레이 아이콘 클릭으로 다시 표시. 트레이 메뉴에서 완전 종료 가능
- **Windows 로그인 시 자동 실행** 등록
- 창 위치, 미니/고정 상태 등은 재시작해도 유지

## 설정 방법 (새 컴퓨터에서)

별도로 준비해야 할 API 키나 credentials 파일이 없습니다. 딱 아래만 하면 됩니다.

```bash
git clone https://github.com/bbloo13/youtube-music-widget.git
cd youtube-music-widget
npm install
npm start
```

첫 실행 시 로그인이 안 되어 있으면 실제 구글 로그인 페이지를 띄우는 별도 창이 자동으로 열립니다. 그 창에서 평소처럼 구글 계정으로 로그인하면 (비밀번호/2단계 인증 포함, 이건 위젯이 대신할 수 없고 직접 해야 함) 로그인 창은 자동으로 닫히고 보관함이 로드됩니다. 이후로는 로그인 정보가 `userData` 폴더에 캐시되어 재시작해도 다시 로그인할 필요가 없습니다.

### 시작 메뉴 아이콘 (선택)

`npm start`로 매번 터미널에서 켜는 게 불편하면 시작 메뉴 바로가기를 만들 수 있습니다 (PowerShell, Windows 전용):

```powershell
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\YouTube Music.lnk")
$Shortcut.TargetPath = "<repo-절대경로>\node_modules\electron\dist\electron.exe"
$Shortcut.Arguments = "."
$Shortcut.WorkingDirectory = "<repo-절대경로>"
$Shortcut.IconLocation = "<repo-절대경로>\assets\icon.ico"
$Shortcut.Save()
```

## 구조

- `src/main.js` — 창/트레이/미니 모드/자동실행/IPC 핸들러
- `src/ytMusicService.js` — `youtubei.js` 래퍼 (보관함 조회, 재생목록 조회, 스트림 URL 추출)
- `src/preload.js` — 렌더러에 노출하는 IPC API
- `src/renderer/` — UI (HTML/CSS/JS, 프레임 없는 다크 위젯)

## 주의

- 로그인/재생은 유튜브 뮤직 내부(비공개) API를 그대로 쓰는 `youtubei.js` 기반이라, 유튜브 쪽 내부 구조가 바뀌면 가끔 손봐야 할 수 있습니다.
