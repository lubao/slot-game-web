import { _decorator, Component, Sprite, SpriteFrame, CCString } from 'cc';
const { ccclass, property } = _decorator;

/**
 * SymbolView
 * 掛在單一符號 Prefab 上的檢視元件。
 * 依符號 ID 從對照表中挑出對應的 SpriteFrame，換到自身的 Sprite 上。
 * 純顯示用途：不連網路、不計算任何邏輯或獎金。
 */
@ccclass('SymbolView')
export class SymbolView extends Component {
    // 符號圖集：每一格對應一個符號的 SpriteFrame。
    // 順序必須與 frameIds 完全對齊（index 相同代表同一個符號）。
    @property({ type: [SpriteFrame] })
    public frames: SpriteFrame[] = [];

    // 符號 ID 字串陣列，順序與 frames 對齊。
    // 例如 frameIds[3] 就是 frames[3] 這張圖代表的符號 ID。
    @property([CCString])
    public frameIds: string[] = [];

    /**
     * 依符號 ID 設定要顯示的圖。
     * 在 frameIds 找到對應 index 後，把該 index 的 frames 指定給 Sprite。
     * 找不到 ID、或該 index 沒有對應 frame 時，印出 console.warn 並保持原狀。
     * @param id 符號 ID（大小寫需與 frameIds 內的字串完全一致）
     */
    public setSymbol(id: string): void {
        const index = this.frameIds.indexOf(id);
        if (index < 0) {
            // 找不到這個符號 ID
            console.warn(`[SymbolView] unknown symbol id: "${id}"`);
            return;
        }

        const frame = this.frames[index];
        if (!frame) {
            // ID 有對到，但 frames 這一格是空的（frames 與 frameIds 長度不一致）
            console.warn(`[SymbolView] no SpriteFrame bound at index ${index} for id: "${id}"`);
            return;
        }

        const sprite = this.getComponent(Sprite);
        if (!sprite) {
            // 節點上沒有 Sprite 元件可供換圖
            console.warn('[SymbolView] missing Sprite component on this node');
            return;
        }

        sprite.spriteFrame = frame;
    }
}
