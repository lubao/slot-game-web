import { _decorator, Component, Node, Vec3, tween, Tween, instantiate, Prefab } from 'cc';
import { ReelView } from './ReelView';
import { SymbolView } from './SymbolView';
const { ccclass, property } = _decorator;

// UI_2D layer 的數值（33554432）。
// 本場景的 UICamera 只渲染這個 layer，任何 instantiate 出的暫時節點都必須設成它，
// 否則會產生 DrawCall 但畫面上看不到。
const UI_2D_LAYER = 33554432;

/**
 * ReelSpinner
 * 單一轉輪（Reel_N）的滾動動畫元件，與同節點的 ReelView 並存。
 * 職責：
 *   - startSpin()：開始無限垂直滾動的視覺效果。
 *   - stopSpin(finalSymbolIds)：停止滾動，並讓這一欄最終顯示傳入的 3 個符號
 *     （透過同節點的 ReelView.setColumn 換上正式盤面），停輪時加回彈手感。
 * 本元件只做「看起來在轉」的視覺效果，不做逐格物理精準、不算任何獎金。
 *
 * 做法（簡化版）：
 *   在自身節點下建立一個「滾動容器 spinRoot」，容器內塞多顆暫時符號並垂直排列，
 *   以 tween + repeatForever 讓容器持續往下位移；每跑完一圈就把 Y 歸位，
 *   形成無縫的循環滾動。停輪時淡出滾動容器、還原 ReelView 的正式盤面。
 */
@ccclass('ReelSpinner')
export class ReelSpinner extends Component {
    // 符號 Prefab（Symbol.prefab）。滾動時的暫時符號由它 instantiate 出來。
    // 若未指定，會嘗試沿用同節點 ReelView 的 symbolPrefab。
    @property(Prefab)
    public symbolPrefab: Prefab | null = null;

    // 相鄰符號之間的垂直間距（像素）。應與 ReelView.spacing 對齊，滾動看起來才連貫。
    @property
    public spacing: number = 140;

    // 滾動時容器內要放幾顆暫時符號（越多循環越不易穿幫，通常 6~8 顆即可）。
    @property
    public tileCount: number = 6;

    // 滾動速度：跑完「一格 spacing」所需秒數。越小越快。
    @property
    public secondsPerStep: number = 0.06;

    // 停輪回彈（backOut）緩動的時間長度（秒），營造「卡榫」手感。
    @property
    public settleDuration: number = 0.35;

    // 用來裝滾動符號的暫時容器節點；startSpin 時建立，stopSpin 時清除。
    private _spinRoot: Node | null = null;

    // 目前的滾動 tween，方便停輪時 stop。
    private _spinTween: Tween<Node> | null = null;

    // 是否正在滾動中。
    private _spinning: boolean = false;

    /**
     * 取得可用的符號 Prefab：優先用自身指定的，否則沿用同節點 ReelView 的。
     */
    private resolvePrefab(): Prefab | null {
        if (this.symbolPrefab) {
            return this.symbolPrefab;
        }
        const reelView = this.getComponent(ReelView);
        if (reelView && reelView.symbolPrefab) {
            return reelView.symbolPrefab;
        }
        return null;
    }

    /**
     * 開始無限滾動動畫。
     * 步驟：
     *   1. 若已在滾動則忽略（避免重複建立容器）。
     *   2. 隱藏 ReelView 的靜態盤面（把既有子節點停用），避免與滾動容器重疊。
     *   3. 建立滾動容器 spinRoot，塞入 tileCount 顆隨機暫時符號並垂直排列。
     *   4. 以 tween 讓容器往下位移一格後 Y 歸位，repeatForever 形成循環。
     */
    public startSpin(): void {
        if (this._spinning) {
            return;
        }

        const prefab = this.resolvePrefab();
        if (!prefab) {
            console.warn('[ReelSpinner] 找不到 symbolPrefab（自身與 ReelView 皆未指定），無法滾動');
            return;
        }

        this._spinning = true;

        // 2. 暫時停用 ReelView 排出的靜態符號（滾動期間不顯示正式盤面）。
        this.setStaticSymbolsActive(false);

        // 3. 建立滾動容器
        const spinRoot = new Node('SpinRoot');
        spinRoot.setParent(this.node);
        spinRoot.setPosition(Vec3.ZERO);
        spinRoot.layer = UI_2D_LAYER;
        this._spinRoot = spinRoot;

        // 容器內用來循環滾動的候選符號（隨意挑幾種，純視覺）。
        const pool = ['DRAGON', 'PHOENIX', 'KOI', 'WILD', 'ACE', 'KING', 'QUEEN', 'JACK', 'TEN', 'INGOT'];

        // 以節點原點為中心垂直排列 tileCount 顆符號。
        const startY = ((this.tileCount - 1) * this.spacing) / 2;
        for (let i = 0; i < this.tileCount; i++) {
            const cell = instantiate(prefab);
            cell.setParent(spinRoot);
            cell.setPosition(new Vec3(0, startY - i * this.spacing, 0));
            cell.layer = UI_2D_LAYER;
            cell.walk((child: Node) => {
                child.layer = UI_2D_LAYER;
            });
            const view = cell.getComponent(SymbolView);
            if (view) {
                view.setSymbol(pool[i % pool.length]);
            }
        }

        // 4. 循環滾動：往下位移一格 spacing 後瞬間歸位，無限重複。
        //    位移量用負值代表往下（Cocos 2D 座標 Y 往上為正）。
        this._spinTween = tween(spinRoot)
            .repeatForever(
                tween(spinRoot)
                    .by(this.secondsPerStep, { position: new Vec3(0, -this.spacing, 0) })
                    .call(() => {
                        // 每跑完一格就把 Y 歸位，形成無縫循環的視覺。
                        spinRoot.setPosition(Vec3.ZERO);
                    })
            )
            .start();
    }

    /**
     * 停止滾動，並讓這一欄最終顯示傳入的 3 個符號。
     * 步驟：
     *   1. 停掉無限滾動 tween、清除滾動容器。
     *   2. 呼叫同節點 ReelView.setColumn(finalSymbolIds) 排出正式盤面並重新顯示。
     *   3. 對盤面容器（this.node）做一個 backOut 回彈緩動，營造「卡榫」手感。
     *   4. 回彈結束後 resolve，讓呼叫方可 await。
     * @param finalSymbolIds 這一欄最終要顯示的 3 個符號 ID
     * @returns 停輪動畫完成的 Promise（可 await）
     */
    public stopSpin(finalSymbolIds: string[]): Promise<void> {
        return new Promise<void>((resolve) => {
            // 1. 停掉滾動並清除暫時容器
            if (this._spinTween) {
                this._spinTween.stop();
                this._spinTween = null;
            }
            if (this._spinRoot) {
                this._spinRoot.destroy();
                this._spinRoot = null;
            }
            this._spinning = false;

            // 2. 排出正式盤面（ReelView 內部會清空後重建並顯示）
            const reelView = this.getComponent(ReelView);
            if (reelView) {
                reelView.setColumn(finalSymbolIds);
            } else {
                console.warn('[ReelSpinner] 同節點缺少 ReelView，無法設定最終盤面');
            }

            // 3. backOut 回彈：先把盤面往下壓一點，再彈回原位，做出停輪卡榫感。
            const target = this.node;
            Tween.stopAllByTarget(target);
            target.setPosition(new Vec3(target.position.x, -this.spacing * 0.5, target.position.z));
            tween(target)
                .to(this.settleDuration, { position: new Vec3(target.position.x, 0, target.position.z) }, { easing: 'backOut' })
                .call(() => {
                    // 4. 完成，通知呼叫方
                    resolve();
                })
                .start();
        });
    }

    /**
     * 啟用或停用 ReelView 排出的靜態符號子節點。
     * 注意：滾動容器 SpinRoot 也是本節點的子節點，需排除它，避免被一起關掉。
     * @param active 是否顯示
     */
    private setStaticSymbolsActive(active: boolean): void {
        const children = this.node.children;
        for (const child of children) {
            if (child === this._spinRoot) {
                continue;
            }
            child.active = active;
        }
    }

    /**
     * 元件銷毀時清理殘留的 tween 與暫時節點，避免記憶體洩漏。
     */
    onDestroy() {
        if (this._spinTween) {
            this._spinTween.stop();
            this._spinTween = null;
        }
        Tween.stopAllByTarget(this.node);
        if (this._spinRoot && this._spinRoot.isValid) {
            this._spinRoot.destroy();
            this._spinRoot = null;
        }
    }
}
