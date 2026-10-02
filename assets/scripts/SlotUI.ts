import { _decorator, Component, Label } from 'cc';
import { WinCounter } from './WinCounter';
const { ccclass, property } = _decorator;

/**
 * SlotUI
 * 老虎機的 UI 顯示與下注控制元件，掛在 UILayer（或 ReelRoot，擇一）。
 * 職責：
 *   - 顯示餘額 / 下注 / 贏分三個 Label（金額一律兩位小數）。
 *   - 管理可下注檔位（betLevelsMinor）與目前選取的檔位（betIndex）。
 *   - 委派 WinCounter 播放贏分數字跳動。
 * 本元件「只負責顯示」：不自己扣款 / 加獎，餘額的實際增減由 SpinController 傳入
 * （本機假邏輯）。Phase 5 會改由伺服器回傳的 balance 直接 setBalance。
 */
@ccclass('SlotUI')
export class SlotUI extends Component {
    // 餘額 Label（拖 UILayer/BalanceLabel 的 cc.Label 進來）。
    @property(Label)
    public balanceLabel: Label | null = null;

    // 下注 Label（拖 UILayer/BetLabel 的 cc.Label 進來）。
    @property(Label)
    public betLabel: Label | null = null;

    // 贏分數字跳動元件（拖掛在 WinLabel 上的 WinCounter 進來）。
    @property(WinCounter)
    public winCounter: WinCounter | null = null;

    // 可下注檔位（整數 minor），預設選第 0 檔。
    // 對應引擎 betLines=20 的倍數：例如 20、100、500、2000。
    @property({ type: [Number] })
    public betLevelsMinor: number[] = [20, 100, 500, 2000];

    // 目前顯示的餘額（整數 minor），僅作顯示快取用。
    // 零信任：餘額一律由伺服器決定——連線後 sessionInit.balance 設初值，
    //   每輪結束用 spinResult.balance 更新；本機不自行扣款 / 加獎。預設 0（尚未連線）。
    private _balanceMinor: number = 0;

    // 目前選取的下注檔位索引（對應 betLevelsMinor）。
    private _betIndex: number = 0;

    /**
     * 把一個整數 minor 值格式化成兩位小數字串。
     * 例如 1000000 → "10000.00"、6 → "0.06"、20 → "0.20"。
     * 共用工具，WinCounter 內部也用同樣規則格式化。
     * @param valueMinor 金額（整數 minor）
     */
    public static formatMinor(valueMinor: number): string {
        return (valueMinor / 100).toFixed(2);
    }

    /**
     * 元件啟動時初始化下注與贏分顯示。
     * 餘額不在此設定：等 GameFlow 收到伺服器 sessionInit 後才 setBalance，
     *   連線前先顯示佔位（避免出現看似真實的假餘額）。
     */
    start() {
        this.balanceLabel && (this.balanceLabel.string = '餘額: —');
        this.refreshBetLabel();
        this.resetWin();
    }

    /**
     * 更新餘額顯示。只負責「顯示」。
     * 零信任：要顯示的數字一律由伺服器而來（sessionInit.balance 或 spinResult.balance），
     *   客戶端不自行計算餘額。
     * @param valueMinor 要顯示的餘額（整數 minor）
     */
    public setBalance(valueMinor: number): void {
        this._balanceMinor = valueMinor;
        if (this.balanceLabel) {
            this.balanceLabel.string = `餘額: ${SlotUI.formatMinor(valueMinor)}`;
        }
    }

    /**
     * 取得目前選取的下注額（整數 minor）。
     * 若檔位陣列為空則回傳 0（防呆）。
     */
    public getCurrentBetMinor(): number {
        if (!this.betLevelsMinor || this.betLevelsMinor.length === 0) {
            return 0;
        }
        return this.betLevelsMinor[this._betIndex];
    }

    /**
     * 切換到下一個（較高）下注檔位，循環回頭，並更新 betLabel。
     * （此階段先不綁專屬加減按鈕，可暫時掛在 AUTO/TURBO 或由 console 測試；
     *   真正的下注 UI 之後再細修。）
     */
    public cycleBetUp(): void {
        if (!this.betLevelsMinor || this.betLevelsMinor.length === 0) {
            return;
        }
        this._betIndex = (this._betIndex + 1) % this.betLevelsMinor.length;
        this.refreshBetLabel();
    }

    /**
     * 切換到上一個（較低）下注檔位，循環回頭，並更新 betLabel。
     */
    public cycleBetDown(): void {
        if (!this.betLevelsMinor || this.betLevelsMinor.length === 0) {
            return;
        }
        const n = this.betLevelsMinor.length;
        this._betIndex = (this._betIndex - 1 + n) % n;
        this.refreshBetLabel();
    }

    /**
     * 播放贏分數字跳動：從 0 滾動到 winMinor。
     * 只負責顯示動畫；餘額的實際加獎由呼叫方（SpinController）處理。
     * @param winMinor 本輪贏分（整數 minor）
     * @returns 動畫完成的 Promise（可 await，讓呼叫方等跳動播完再加餘額）
     */
    public showWin(winMinor: number): Promise<void> {
        if (!this.winCounter) {
            console.warn('[SlotUI] 未綁定 WinCounter，無法播放贏分跳動');
            return Promise.resolve();
        }
        return this.winCounter.rollTo(0, winMinor);
    }

    /**
     * 重置贏分顯示為 0（不帶動畫）。
     */
    public resetWin(): void {
        if (this.winCounter) {
            this.winCounter.setImmediate(0);
        }
    }

    /**
     * 依目前選取的檔位更新 betLabel 顯示。
     */
    private refreshBetLabel(): void {
        if (this.betLabel) {
            this.betLabel.string = `下注: ${SlotUI.formatMinor(this.getCurrentBetMinor())}`;
        }
    }
}
