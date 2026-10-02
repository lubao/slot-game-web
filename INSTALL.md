# Installation & Setup

This project is developed with [Cocos Creator](https://www.cocos.com/en/creator) 3.8.8 and the [Kiro](https://kiro.dev) AI IDE. Kiro drives the Cocos editor through an MCP (Model Context Protocol) bridge provided by the **Funplay Cocos MCP** editor extension and surfaced in Kiro as the **Cocos Accelerator** Power.

There are three pieces to configure, in order:

1. **Kiro** — the AI IDE you run.
2. **The Cocos MCP server** — an editor extension that exposes the running Cocos Creator editor over HTTP.
3. **The Kiro Power / MCP client** — Kiro's connection to that server.

---

## 1. Install Kiro

1. Download and install Kiro from [kiro.dev](https://kiro.dev).
2. Open this project folder in Kiro.
3. Kiro reads configuration from two scopes:
   - **User scope:** `~/.kiro/settings/` (applies to every workspace)
   - **Workspace scope:** `.kiro/settings/` inside the project
   Later scopes override earlier ones.

On Windows the user scope resolves to `C:\Users\<you>\.kiro\`.

---

## 2. Install and start the Cocos MCP server

The MCP server is the **Funplay Cocos MCP** extension that runs inside the Cocos Creator editor. This repository already bundles it under `extensions/funplay-cocos-mcp/` (it is a third-party package with its own git history and is excluded from this repo via `.gitignore`).

1. Open this project in **Cocos Creator 3.8.8**.
2. Make sure the extension is present under `extensions/funplay-cocos-mcp/`. If it is missing, obtain it and place it there, then restart Cocos Creator.
3. In Cocos Creator open the **Cocos MCP Server** panel (via the editor's extension menu).
4. Confirm the server endpoint. For this project it is configured in `funplay-cocos-mcp.config.json`:

   ```json
   {
     "host": "127.0.0.1",
     "port": 20550,
     "portMode": "project",
     "autostart": true
   }
   ```

   - `host` / `port` give the endpoint `http://127.0.0.1:20550/`.
   - `portMode: "project"` means the port is derived per-project, so the number can differ on another machine — always read the actual URL from the Cocos MCP Server panel.
   - `autostart: true` starts the server when the editor opens.

> The endpoint only talks to the Cocos Creator editor on `localhost`. It is never exposed to external networks.

---

## 3. Configure the Kiro Power and MCP client

Kiro connects to the Cocos server in two complementary ways, both defined in `~/.kiro/settings/mcp.json`:

- a standard **MCP server** entry, and
- a **Power** entry (`kiro-cocos-accelerator`) that packages the Cocos tooling, docs, and workflow guidance.

Example `~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "cocos-firstslotgam-551292": {
      "type": "http",
      "url": "http://127.0.0.1:20550/",
      "disabled": true
    }
  },
  "powers": {
    "mcpServers": {
      "power-kiro-cocos-accelerator-cocos-creator": {
        "url": "http://localhost:20550/",
        "autoApprove": ["*"]
      }
    }
  }
}
```

Field notes:

- **`url`** — must match the endpoint shown in the Cocos MCP Server panel (port `20550` for this project; yours may differ because `portMode` is `project`).
- **`type: "http"`** — the server speaks HTTP; keep this for the `mcpServers` entry.
- **`disabled`** — when the Power entry is active you can leave the plain `mcpServers` entry `disabled: true` to avoid two clients competing for the same server. Flip it to `false` if you want to use the raw MCP server directly instead of the Power.
- **`autoApprove: ["*"]`** — approves every tool from the Power without a per-call prompt. Narrow this to specific tool names if you want tighter control.

### Activating the Power

With the Power configured, Kiro exposes the Cocos Accelerator tools (scene, node, component, asset, prefab, and preview operations). You generally do not call them by hand — ask Kiro to do Cocos work (create a scene, build a node tree, run a browser preview) and it uses the Power.

---

## 4. Verify the setup

1. Start **Cocos Creator** with this project open and confirm the Cocos MCP Server panel shows the server **running** at the expected URL.
2. Open the project in **Kiro**.
3. Ask Kiro to perform a read-only Cocos action, for example: *"list all nodes in the current scene."* If it returns the scene hierarchy, the full chain — Kiro → Power → MCP server → Cocos editor — is working.

---

## Troubleshooting

- **Kiro can't reach the server / connection refused** — Cocos Creator isn't running, the extension didn't start, or the port is wrong. Open the Cocos MCP Server panel, read the live URL, and update `url` in `mcp.json` to match.
- **Port mismatch** — because `portMode` is `project`, the port can change between machines or projects. The panel is the source of truth; copy its URL into both the config and `mcp.json`.
- **Tools prompt for approval every call** — add `"autoApprove": ["*"]` (or specific tool names) to the Power entry.
- **Changes made via scripts vanish after a reload** — editor-context changes that aren't saved don't persist. Save the scene (Ctrl+S in Cocos) after edits.
- **MCP config changes not picked up** — reconnect the server from Kiro's MCP Server view, or restart Kiro.
