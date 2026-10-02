import { _decorator, Component, Prefab, Node, instantiate, Vec3 } from 'cc';
import { SymbolView } from './SymbolView';
const { ccclass, property } = _decorator;

// UI_2D layer 的數值（33554432）。
// 本場景的 UICamera 只渲染這個 layer，任何要顯示的節點都必須設成它，
// 否則會產生 DrawCall 但畫面上看不到。
const UI_2D_LAYER = 33554432;

/**
 * ReelView
 * 掛在每個 Reel_N 節點上，負責把一整欄（3 顆）符號靜態排出來。
 * 這個階段不做滾動動畫，只要能依傳入的符號 ID 顯示對應色塊即可。
 * 純顯示用途：不連網路、不計算任何邏輯或獎金。
 */
@ccclass('ReelView')
export class ReelView extends Component {
    // 符號 Prefab（Symbol.prefab）。每一顆符號都由它 instantiate 出來。
    @property(Prefab)
    public symbolPrefab: Prefab | null = null;

    // 相鄰符號之間的垂直間距（像素），可在 Inspector 調整。
    @property
    public spacing: number = 140;

    /**
     * 設定這一欄要顯示的符號。
     * 步驟：
     *   1. 清掉目前所有子節點（重設欄位）。
     *   2. 依傳入的符號 ID 陣列，逐一 instantiate 符號 Prefab。
     *   3. 垂直排列：第 0 顆在最上方，往下每顆間隔 spacing。
     *   4. 每顆 instantiate 後強制把 layer 設成 UI_2D，確保 UICamera 看得到。
     *   5. 呼叫該顆的 SymbolView.setSymbol(id) 換上對應圖。
     * @param symbolIds 符號 ID 陣列（通常長度為 3）
     */
    public setColumn(symbolIds: string[]): void {
        // 1. 清空現有子節點
        this.node.removeAllChildren();

        if (!this.symbolPrefab) {
            console.warn('[ReelView] symbolPrefab is not assigned');
            return;
        }

        const count = symbolIds.length;
        // 讓整欄以節點原點為中心對齊：頂部起始 y 為 (count-1)/2 * spacing
        const startY = ((count - 1) * this.spacing) / 2;

        for (let i = 0; i < count; i++) {
            const id = symbolIds[i];

            // 2. 產生一顆符號
            const cell: Node = instantiate(this.symbolPrefab);
            cell.setParent(this.node);

            // 3. 垂直排列：index 0 在最上方，往下遞減 y
            cell.setPosition(new Vec3(0, startY - i * this.spacing, 0));

            // 4. 強制設成 UI_2D layer（含所有子節點），否則 UICamera 畫不出來
            cell.layer = UI_2D_LAYER;
            cell.walk((child: Node) => {
                child.layer = UI_2D_LAYER;
            });

            // 5. 換上對應符號圖
            const view = cell.getComponent(SymbolView);
            if (view) {
                view.setSymbol(id);
            } else {
                console.warn('[ReelView] instantiated symbol has no SymbolView component');
            }
        }
    }
}
