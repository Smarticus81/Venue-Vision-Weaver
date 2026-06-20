Place an ffmpeg executable here when the deploy image does not provide ffmpeg on PATH.

Expected filenames:
- Linux/macOS: `ffmpeg`
- Windows: `ffmpeg.exe`

The API build copies this folder to `artifacts/api-server/dist/bin`. At runtime,
`FFMPEG_PATH` still takes precedence when it is set.
