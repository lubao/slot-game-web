import { _decorator, Component, Node, Vec3, tween, Tween, UIOpacity } from 'cc';
import { ReelView } from './ReelView';
const { ccclass, property } = _decorator;

/**
 * WinLineCell
 * 一條中獎線上的單一格子座標：第幾欄（reel）、第幾列（row）。
 * reel 對應 ReelView 陣列的索引（0 ~ 4），row 對應該欄內符號的列索引
 * （0 在最上方，與 ReelView.setColumn 的排列一致）。
 * 欄位語意對齊 Phase 2 伺服器 spinResult.winLines 的格子表示，Phase 5 可直接餵。
 */
export interface WinLineCell {
    reel: number;
    row: number;
}

/**
 * WinLineInfo
 * 一條中獎線的資訊。目前只需要「這條線經過哪些格子」。
 * 結構刻意簡單並對齊伺服器語意：Phase 5 伺服器回傳的 winLines 只要含 cells 即可直接使用。
 * （未來若伺服器再帶 lineId / payout 等欄位，可往這個介面擴充，不影響高亮介面。）
 */
export interface WinLineInfo {
    cells: WinLineCell[];
}

/**
 * WinLineHighlighter
 * 中獎符號高亮元件，掛在 ReelRoot（與 SpinController 同節點或鄰近）。
 * 職責：
 *   接收「哪些格子中獎」的外部資料（winLines），對這些格子做放大→縮回的閃爍動畫。
 * 零信任接縫：winLines 一律由外部傳入（本階段為假資料，Phase 5 換成伺服器回傳的 winLines，
 *   介面不變）。本元件絕不自己判斷中獎，只負責「把被指定的格子高亮出來」。
 */
@ccclass('WinLineHighlighter')
export class WinLineHighlighter extends Component {
    // 5 欄的 ReelView，依序對應 Reel_0 ~ Reel_4（在 Inspector 拖進來）。
    // 透過 ReelView 的節點取得每一格的符號子節點（node.children[row]）。
    @property({ type: [ReelView] })
    public reels: ReelView[] = [];

    // 每個中獎格子要閃幾次（一次 = 放大再縮回）。
    @property
    public flashTimes: number = 3;

    // 單次閃爍（放大→縮回）的總時間（毫秒）。
    @property
    public flashDurationMs: number = 250;

    // 閃爍時放大的倍率（1 → scaleUp → 1）。
    @property
    public scaleUp: number = 1.2;

    // 本輪被高亮的符號節點集合，clearHighlight 時用來復原。
    private _highlighted: Node[] = [];

    /**
     * 高亮所有中獎線上的格子。
     * 做法：
     *   1. 先清掉上一輪殘留的高亮（復原 scale / opacity）。
     *   2. 把多條線的格子取聯集（同一格只閃一次），解析成實際符號節點。
     *   3. 對每個節點做 flashTimes 次「scale 1 → scaleUp → 1」的 tween 閃爍，
     *      同時用 UIOpacity 做輕微的明暗變化加強效果。
     *   4. 全部閃完後 resolve（可 await）。
     * @param winLines 中獎線資料（外部傳入，本元件不自行判斷中獎）
     * @returns 高亮動畫完成的 Promise（可 await）
     */
    public highlight(winLines: WinLineInfo[]): Promise<void> {
        return new Promise<void>((resolve) => {
            // 1. 先復原上一輪的高亮。
            this.clearHighlight();

            // 沒有中獎線就直接結束，不做任何事。
            if (!winLines || winLines.length === 0) {
                resolve();
                return;
            }

            // 2. 取聯集：用 "reel,row" 當 key 去重，解析成符號節點。
            const seen = new Set<string>();
            const targets: Node[] = [];
            for (const line of winLines) {
                if (!line || !line.cells) {
                    continue;
                }
                for (const cell of line.cells) {
                    const key = `${cell.reel},${cell.row}`;
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    const node = this.resolveCellNode(cell.reel, cell.row);
                    if (node) {
                        targets.push(node);
                    }
                }
            }

            // 解析不到任何節點（例如 reels 未綁或座標越界）就結束。
            if (targets.length === 0) {
                console.warn('[WinLineHighlighter] 沒有可高亮的格子（reels 未綁定或座標越界？）');
                resolve();
                return;
            }

            this._highlighted = targets;

            // 3. 對每個目標節點做閃爍。所有節點同時進行，等最後一個完成再 resolve。
            const halfSec = Math.max(0, this.flashDurationMs) / 2 / 1000;
            let remaining = targets.length;
            const onOneDone = () => {
                remaining--;
                if (remaining <= 0) {
                    resolve();
                }
            };

            for (const node of targets) {
                // 確保節點上有 UIOpacity 可做明暗變化（沒有就補一個）。
                let opacity = node.getComponent(UIOpacity);
                if (!opacity) {
                    opacity = node.addComponent(UIOpacity);
                }

                // scale 閃爍：重複 flashTimes 次「放大→縮回」。
                Tween.stopAllByTarget(node);
                tween(node)
                    .repeat(
                        Math.max(1, this.flashTimes),
                        tween(node)
                            .to(halfSec, { scale: new Vec3(this.scaleUp, this.scaleUp, 1) }, { easing: 'sineOut' })
                            .to(halfSec, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' })
                    )
                    .call(onOneDone)
                    .start();

                // opacity 閃爍：同步做輕微明暗（255 → 160 → 255），純視覺加強。
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 255;
                tween(opacity)
                    .repeat(
                        Math.max(1, this.flashTimes),
                        tween(opacity)
                            .to(halfSec, { opacity: 160 })
                            .to(halfSec, { opacity: 255 })
                    )
                    .start();
            }
        });
    }

    /**
     * 清除所有高亮，把被高亮過的符號節點 scale / opacity 復原。
     * 下一輪開始前（進 Spinning）呼叫，確保不殘留上一輪的放大 / 半透明狀態。
     */
    public clearHighlight(): void {
        for (const node of this._highlighted) {
            if (!node || !node.isValid) {
                continue;
            }
            Tween.stopAllByTarget(node);
            node.setScale(1, 1, 1);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) {
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 255;
            }
        }
        this._highlighted = [];
    }

    /**
     * 把 (reel, row) 座標解析成實際的符號節點。
     * reel 對應 reels 陣列索引；row 對應該欄 ReelView 節點下的子節點索引
     * （與 ReelView.setColumn 的排列一致：index 0 在最上方）。
     * @param reel 欄索引
     * @param row 列索引
     * @returns 對應的符號節點；越界或未綁定時回傳 null
     */
    private resolveCellNode(reel: number, row: number): Node | null {
        if (reel < 0 || reel >= this.reels.length) {
            return null;
        }
        const view = this.reels[reel];
        if (!view || !view.node) {
            return null;
        }
        const children = view.node.children;
        if (row < 0 || row >= children.length) {
            return null;
        }
        return children[row];
    }

    /**
     * 元件銷毀時復原殘留高亮，避免 tween 回呼在節點失效後仍被觸發。
     */
    onDestroy() {
        this.clearHighlight();
    }
}
