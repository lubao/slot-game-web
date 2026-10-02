---
inclusion: auto
name: Cocos MCP Snapshot Policy
description: How to take screenshots/snapshots via the Cocos MCP server reliably, avoiding window-overlap/wrong-region capture, and how to save the result to the Desktop. Activate for any task about capturing a screenshot, snapshot, game preview image, scene image, or visual verification of the Cocos editor/game.
---

# Cocos MCP Snapshot Policy

Guidance for capturing screenshots/snapshots through the Cocos MCP server
(power: `kiro-cocos-accelerator`, server: `cocos-creator`) so captures do not
hit the window-overlap / wrong-region problem, and so the final image is saved
to the Desktop.

## The window-overlap problem

Panel-cropped capture tools try to crop a specific panel region out of the
editor window. When editor panels overlap, the Game/Preview panel is not the
front-most region, the layout differs from the default, or a browser preview
runs in an external window, these tools either crop the wrong area (e.g. only
the toolbar strip) or fail outright with messages such as
"Could not locate a visible 'game' panel in the target window."

Affected (panel-cropping) tools — avoid relying on their cropping:
- `capture_game_screenshot`
- `capture_scene_screenshot`
- `capture_preview_screenshot` (external browser preview has no editor panel)

## Preferred capture method (reliable)

1. Use **Editor Game View** preview, not external Browser preview, when the
   goal is a game image. Browser preview opens a separate OS window the MCP
   panel-croppers cannot see.
   - `set_preview_mode` / `run_project_preview` with `mode: "gameView"`.
2. Make sure the editor window is the capture target:
   - Call `list_editor_windows` and pick the entry whose `kind` is `editor`
     and `visible` is `true` (title contains `MainGame.scene - firstSlotGame`).
3. Capture the **whole focused editor window** with `capture_editor_screenshot`
   and pass `titleContains` so targeting is deterministic even when no window
   is focused:
   - `capture_editor_screenshot` with
     `titleContains: "Cocos Creator"` (or a more specific scene title) and an
     explicit `fileName`.
   - This grabs the full editor window (Game View included) and sidesteps the
     fragile per-panel cropping entirely.

Rationale: capturing the full focused window is robust to panel layout and
overlap; we only lose some surrounding editor chrome, which is acceptable for
verification snapshots.

## Fallbacks

- If panel cropping is explicitly required, first bring the needed panel to the
  front and verify with `list_editor_windows`, then call
  `capture_game_screenshot` / `capture_scene_screenshot` with an explicit
  `windowKind: "editor"` and `titleContains`. Treat a toolbar-only or failed
  crop as a signal to fall back to `capture_editor_screenshot`.
- For a true full-desktop image (e.g. external browser preview), use
  `capture_desktop_screenshot`.

## Output location: save to the Desktop

All capture tools write under `temp/mcp-captures/` inside the project and only
accept a `fileName` (not a directory). To deliver the snapshot to the Desktop:

1. Capture with an explicit, descriptive `fileName`, e.g.
   `fileName: "slot-snapshot.png"`.
2. Copy the produced file from `temp/mcp-captures/` to the user's Desktop with
   a shell command. The latest capture is the newest `.png` in that folder.

PowerShell (Windows) example — copy the most recent capture to the Desktop:

```powershell
$src = Get-ChildItem "temp/mcp-captures" -Filter *.png |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
$dest = Join-Path $env:USERPROFILE ("Desktop\" + $src.Name)
Copy-Item $src.FullName $dest -Force
Write-Output $dest
```

Notes:
- Use `$env:USERPROFILE\Desktop`, never a hardcoded user path, so it works for
  any account.
- Keep `temp/mcp-captures/` as the capture source; it is git-ignored scratch
  space. The Desktop copy is the deliverable.
- When verifying visually in chat, read the Desktop copy (or the
  `temp/mcp-captures` original) with the file-reading tool.

## Checklist for a game snapshot to Desktop

1. `run_project_preview` / `set_preview_mode` → `mode: "gameView"`.
2. `list_editor_windows` → confirm the editor window is visible.
3. `capture_editor_screenshot` with `titleContains` + explicit `fileName`.
4. Copy newest `temp/mcp-captures/*.png` → `$env:USERPROFILE\Desktop`.
5. (Optional) reset preview back to `browser` mode if that was the prior state.
