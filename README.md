# slot-game-web

A slot game client built with [Cocos Creator](https://www.cocos.com/en/creator) 3.8.8. The project renders a 5×3 reel board with placeholder symbol art and a basic UI layer, intended as a front-end foundation for a slot game.

## Requirements

- Cocos Creator 3.8.8
- A modern browser for preview builds

## Getting started

1. Open Cocos Creator and add this folder as a project.
2. Open the scene at `assets/scenes/MainGame.scene`.
3. Use the editor's preview to run it in the browser.

For setting up Kiro, the Cocos Accelerator Power, and the MCP server used to drive the editor, see [INSTALL.md](INSTALL.md).

The project opens on `MainGame.scene`, which contains a `Canvas` with a background, a reel board (`ReelRoot`), and a UI layer.

## Scene structure

```
Canvas
├── UICamera        orthographic, solid-color clear, renders the UI_2D layer
├── Background      full-screen sprite
├── ReelRoot        container for the 5 reels
│   ├── Reel_0 … Reel_4   each holds a ReelView component
└── UILayer         balance / bet / win labels and SPIN / AUTO / TURBO buttons
```

> **Rendering note:** the scene uses a single `UICamera` whose visibility mask is limited to the `UI_2D` layer (`33554432`). Any node that should be visible must be on that layer, otherwise it draws nothing even though it issues a draw call.

## Reel board

The static board is driven by two small view components plus a prefab.

- **`assets/scripts/SymbolView.ts`** — attached to the symbol prefab. Holds parallel arrays `frames: SpriteFrame[]` and `frameIds: string[]`; `setSymbol(id)` swaps the node's `Sprite.spriteFrame` to the frame whose id matches.
- **`assets/scripts/ReelView.ts`** — attached to each `Reel_N`. `setColumn(ids)` clears existing children, instantiates the symbol prefab for each id, lays them out vertically (index 0 on top, `spacing` apart), forces each cell onto the `UI_2D` layer, and calls `SymbolView.setSymbol`.
- **`assets/prefabs/Symbol.prefab`** — a 120×120 sprite node carrying `SymbolView` with the 11 placeholder symbol frames pre-bound.

Symbol ids: `WILD`, `SCATTER`, `DRAGON`, `PHOENIX`, `INGOT`, `KOI`, `ACE`, `KING`, `QUEEN`, `JACK`, `TEN`. The matching 128×128 placeholder textures live in `assets/textures/symbols/`.

## Project layout

```
assets/
├── scenes/      MainGame.scene
├── scripts/     game and view components
│   └── net/     networking stubs
├── prefabs/     Symbol.prefab
├── textures/    symbols/ placeholder art
├── audio/       placeholder sound files
└── resources/   runtime-loadable assets
```

## License

Released under the [MIT License](LICENSE).
