import { _decorator, Component, Label, tween, Tween } from 'cc';
const { ccclass, property } = _decorator;

/**
 * WinCounter
 * 贏分數字滾動動畫元件，掛在 WinLabel 上（或由 SlotUI 持有其參照）。
 * 職責：
 *   只負責「把一個數字動畫地顯示出來」—— 在指定時間內把 Label 上的顯示值
 *   從 from 緩動跳到 to，每幀把當前整數 minor 值格式化成兩位小數字串寫進 label.string。
 * 本元件不做任何遊戲邏輯、不算獎金、不連網路。
 */
@ccclass('WinCounter')
export class WinCounter extends Component {
    // 要更新的 Label（在 Inspector 綁同節點或指定節點上的 cc.Label）。
    @property(Label)
    public label: Label | null = null;

    // 數字跳動動畫的時間長度（毫秒）。
    @property
    public durationMs: number = 600;

    // 顯示前綴，寫進 label.string 時會接在格式化金額前面。
    // 預設 "贏分: "，符合第 3 點要求的「贏分: <formatMinor(win)>」格式。
    @property
    public prefix: string = '贏分: ';

    // 目前這一輪滾動用的 tween，開新動畫前先停掉舊的，避免兩個動畫互相覆寫。
    private _rollTween: Tween<{ v: number }> | null = null;

    /**
     * 以動畫方式把顯示值從 fromMinor 跳到 toMinor。
     * 做法：
     *   用一個暫時物件 { v } 當 tween 目標，在 durationMs 內把 v 從 from 緩動到 to，
     *   每幀（onUpdate）把目前的 v 取整後格式化成兩位小數字串寫進 label.string。
     *   動畫結束時強制寫入精確的 toMinor，避免緩動尾差造成的末格誤差。
     * @param fromMinor 起始金額（整數 minor）
     * @param toMinor 結束金額（整數 minor）
     * @returns 動畫完成的 Promise（可 await）
     */
    public rollTo(fromMinor: number, toMinor: number): Promise<void> {
        return new Promise<void>((resolve) => {
            // 先停掉上一輪可能還在跑的滾動，避免互相覆寫顯示值。
            if (this._rollTween) {
                this._rollTween.stop();
                this._rollTween = null;
            }

            // 沒綁 Label 就直接結束，不擋流程。
            if (!this.label) {
                console.warn('[WinCounter] 未綁定 Label，無法播放數字滾動');
                resolve();
                return;
            }

            // 先把起始值寫上去。
            this.renderValue(fromMinor);

            const state = { v: fromMinor };
            const durationSec = Math.max(0, this.durationMs) / 1000;

            // 時間為 0 或起訖相同時，直接定值即可，不必跑 tween。
            if (durationSec <= 0 || fromMinor === toMinor) {
                this.renderValue(toMinor);
                resolve();
                return;
            }

            this._rollTween = tween(state)
                .to(
                    durationSec,
                    { v: toMinor },
                    {
                        // cubicOut：一開始快、接近結束時放慢，讀起來比線性更有「結算」感。
                        easing: 'cubicOut',
                        onUpdate: () => {
                            // 每幀把目前的 v 取整後顯示（minor 為整數，不顯示小數的 minor 位）。
                            this.renderValue(Math.round(state.v));
                        },
                    }
                )
                .call(() => {
                    // 收尾：寫入精確終值，消除緩動尾差。
                    this.renderValue(toMinor);
                    this._rollTween = null;
                    resolve();
                })
                .start();
        });
    }

    /**
     * 不帶動畫直接設定顯示值（初始化 / 重置用）。
     * 會先停掉進行中的滾動動畫，再把 Label 定在指定值。
     * @param valueMinor 要顯示的金額（整數 minor）
     */
    public setImmediate(valueMinor: number): void {
        if (this._rollTween) {
            this._rollTween.stop();
            this._rollTween = null;
        }
        this.renderValue(valueMinor);
    }

    /**
     * 把一個整數 minor 值格式化後寫進 label.string。
     * 格式與 SlotUI.formatMinor 一致（兩位小數），例如 6 → "0.06"、1000000 → "10000.00"。
     * @param valueMinor 金額（整數 minor）
     */
    private renderValue(valueMinor: number): void {
        if (!this.label) {
            return;
        }
        this.label.string = `${this.prefix}${(valueMinor / 100).toFixed(2)}`;
    }

    /**
     * 元件銷毀時停掉殘留 tween，避免回呼在節點失效後仍被觸發。
     */
    onDestroy() {
        if (this._rollTween) {
            this._rollTween.stop();
            this._rollTween = null;
        }
    }
}
