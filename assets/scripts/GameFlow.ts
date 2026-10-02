import { _decorator, Component, Button, Node, Label, find } from 'cc';
import { SpinController } from './SpinController';
import { SlotUI } from './SlotUI';
import { SlotStateMachine, SlotState } from './SlotStateMachine';
import { SlotWebSocket, SpinError } from './net/SlotWebSocket';
import { toWinLineInfos, type SessionInit, type SpinResult } from './net/SlotProtocol';
const { ccclass, property } = _decorator;

/**
 * GameFlow
 * Phase 5a 的遊戲流程協調器，取代舊的 SpinTestTrigger，掛在常駐節點（Canvas 或 ReelRoot）。
 * 職責：
 *   - 啟動時連線 WebSocket 伺服器；收到 sessionInit 設定初始餘額。
 *   - 接 SpinButton 點擊：防連點 → 送 requestSpin(bet) → 收到伺服器結果才 playRound 演出。
 *   - 連線狀態控制 SpinButton 的可互動性；錯誤分類給繁中訊息。
 * 零信任：本元件不計算任何金額或中獎，一切以伺服器回傳為準。
 *
 * 流程順序（5a）：先向伺服器要結果，收到後才開始轉（本機延遲極低）。
 *   「先轉再等結果」的手感優化留待之後。
 */
@ccclass('GameFlow')
export class GameFlow extends Component {
    // 連線元件（拖常駐節點上的 SlotWebSocket 進來）。
    @property(SlotWebSocket)
    public ws: SlotWebSocket | null = null;

    // 轉輪流程控制器（拖 ReelRoot 上的 SpinController 進來）。
    @property(SpinController)
    public spinController: SpinController | null = null;

    // UI 顯示元件（拖 UILayer 上的 SlotUI 進來）。
    @property(SlotUI)
    public slotUI: SlotUI | null = null;

    // 遊戲狀態機（拖 ReelRoot 上的 SlotStateMachine 進來）。
    @property(SlotStateMachine)
    public fsm: SlotStateMachine | null = null;

    // SPIN 按鈕（拖 Canvas/UILayer/SpinButton 的 Button 進來）。
    @property(Button)
    public spinButton: Button | null = null;

    // 狀態 / 錯誤訊息要顯示的 Label（可選；建議拖 WinLabel 進來）。沒綁就只印 console。
    @property(Label)
    public statusLabel: Label | null = null;

    // 解析到的按鈕節點（供監聽與可互動控制）。
    private _btnNode: Node | null = null;

    // 開場裝飾盤面（集中於此一處）。
    // 僅供開場畫面好看、不代表任何結果；第一次 spin 後即被伺服器 grid 取代。
    // grid[col][row]，row 0 在最上方。
    private static readonly INITIAL_DISPLAY_GRID: string[][] = [
        ['DRAGON', 'KOI', 'ACE'],       // Reel_0
        ['WILD', 'PHOENIX', 'KING'],    // Reel_1
        ['SCATTER', 'INGOT', 'QUEEN'],  // Reel_2
        ['KOI', 'JACK', 'TEN'],         // Reel_3
        ['DRAGON', 'ACE', 'WILD'],      // Reel_4
    ];

    start() {
        // 先畫一次開場裝飾盤面（第一次 spin 後會被伺服器 grid 取代）。
        if (this.spinController) {
            this.spinController.showInitialDisplay(GameFlow.INITIAL_DISPLAY_GRID);
        }

        // 解析 SPIN 按鈕節點（優先用 Inspector 綁定，否則場景路徑後備）。
        this._btnNode = this.resolveButtonNode();
        if (this._btnNode) {
            this._btnNode.on(Button.EventType.CLICK, this.onSpinClicked, this);
        } else {
            console.warn('[GameFlow] 找不到 SPIN 按鈕節點，SPIN 點擊不會觸發');
        }

        // 連線前先把 SPIN 設為不可互動，連上後才開放。
        this.setSpinInteractable(false);

        if (!this.ws) {
            console.warn('[GameFlow] 未綁定 SlotWebSocket，無法連線');
            this.showStatus('未綁定連線元件');
            return;
        }

        // 註冊連線事件後開始連線。
        this.ws.onSessionInit = (init: SessionInit) => this.handleSessionInit(init);
        this.ws.onConnected = () => this.handleConnected();
        this.ws.onDisconnected = () => this.handleDisconnected();
        this.ws.connect();
    }

    onDestroy() {
        if (this._btnNode) {
            this._btnNode.off(Button.EventType.CLICK, this.onSpinClicked, this);
        }
    }

    /**
     * 解析 SPIN 按鈕節點：優先 Inspector 綁定，否則以場景路徑後備尋找。
     */
    private resolveButtonNode(): Node | null {
        if (this.spinButton && this.spinButton.node) {
            return this.spinButton.node;
        }
        return find('Canvas/UILayer/SpinButton');
    }

    /**
     * 收到 sessionInit：設定伺服器初始餘額。
     * 零信任：餘額直接取伺服器 init.balance，不自行計算。
     */
    private handleSessionInit(init: SessionInit): void {
        console.log('[GameFlow] 收到 sessionInit：', JSON.stringify(init));
        if (this.slotUI) {
            this.slotUI.setBalance(init.balance);
        }
        this.showStatus('');
    }

    /**
     * 連線成功：開放 SPIN（若目前為 Idle）。
     */
    private handleConnected(): void {
        this.showStatus('');
        this.refreshSpinInteractable();
    }

    /**
     * 連線中斷：SPIN 設不可互動並顯示提示。
     */
    private handleDisconnected(): void {
        console.warn('[GameFlow] 連線中斷');
        this.showStatus('連線中斷，嘗試重新連線中…');
        this.setSpinInteractable(false);
    }

    /**
     * SPIN 點擊處理：
     *   - 防連點：非 Idle、未連線、或已有請求進行中 → 忽略。
     *   - bet = slotUI.getCurrentBetMinor() → await ws.requestSpin(bet)。
     *   - 成功 → spinController.playRound(grid, toWinLineInfos(result), result)。
     *   - 失敗 → 不播動畫、維持 Idle，顯示對應繁中錯誤訊息。
     */
    private onSpinClicked(): void {
        // 防連點 / 重入守門。
        if (!this.ws || !this.ws.isConnected()) {
            console.log('[GameFlow] 未連線，忽略 SPIN');
            return;
        }
        if (this.ws.isSpinInFlight()) {
            console.log('[GameFlow] 已有 spin 進行中，忽略 SPIN');
            return;
        }
        if (this.fsm && this.fsm.getState() !== SlotState.Idle) {
            console.log(`[GameFlow] 目前非 Idle（${this.fsm.getState()}），忽略 SPIN`);
            return;
        }
        if (!this.slotUI || !this.spinController) {
            console.warn('[GameFlow] 未綁定 slotUI 或 spinController');
            return;
        }

        const bet = this.slotUI.getCurrentBetMinor();
        // 送出期間鎖住按鈕，避免連點（single-flight 另有保護）。
        this.setSpinInteractable(false);
        this.showStatus('');

        this.ws.requestSpin(bet).then(
            (result: SpinResult) => this.onSpinResult(result),
            (err: unknown) => this.onSpinError(err),
        );
    }

    /**
     * 收到伺服器結果：log 原始 JSON，若有 FS 先 log（5a 不演出），再 playRound 演出。
     * 零信任：grid、winLines、金額全部來自伺服器；grid 直接餵、不轉換。
     */
    private onSpinResult(result: SpinResult): void {
        console.log('[GameFlow] 收到 spinResult：', JSON.stringify(result));

        // Free Spins：5a 不演出，只記錄；金額仍以伺服器 totalWin 為準（已含 FS）。
        if (result.totalFreeSpins > 0) {
            console.log(`[GameFlow] 觸發 Free Spins ${result.totalFreeSpins} 次（5b 演出）`);
        }

        const winLines = toWinLineInfos(result);
        // grid 為 string[][]（可能是 readonly 來源），轉成可變型別餵入；內容不改。
        const grid = result.grid.map((col) => [...col]);

        // playRound 內部會推進狀態機並在結束回到 Idle；完成後恢復 SPIN 可互動。
        this.spinController!.playRound(grid, winLines, result).then(() => {
            this.refreshSpinInteractable();
        }, (e: unknown) => {
            console.warn('[GameFlow] playRound 發生例外：', e);
            this.refreshSpinInteractable();
        });
    }

    /**
     * spin 失敗處理：依錯誤碼給繁中訊息；不播動畫、狀態維持 Idle、恢復 SPIN 可互動。
     */
    private onSpinError(err: unknown): void {
        const code = err instanceof SpinError ? err.code : 'INTERNAL_ERROR';
        const msg = this.messageForError(code);
        console.warn(`[GameFlow] spin 失敗（${code}）：${msg}`);
        this.showStatus(msg);
        // 斷線時交由 handleDisconnected 控制按鈕；其餘情況恢復可互動。
        this.refreshSpinInteractable();
    }

    /**
     * 把錯誤碼對應成繁體中文訊息。
     */
    private messageForError(code: string): string {
        switch (code) {
            case 'INVALID_BET':
                return '下注金額無效';
            case 'INSUFFICIENT_BALANCE':
                return '餘額不足';
            case 'RATE_LIMITED':
                return '操作過於頻繁，請稍後再試';
            case 'TIMEOUT':
                return '伺服器回應逾時';
            case 'DISCONNECTED':
                return '連線中斷';
            case 'NOT_CONNECTED':
                return '尚未連線';
            case 'INVALID_SESSION':
                return '連線階段失效，請重新連線';
            case 'INVALID_MESSAGE':
            case 'UNKNOWN_ACTION':
            case 'INTERNAL_ERROR':
            default:
                return '發生錯誤，本次下注未成立';
        }
    }

    /**
     * 依「已連線且目前為 Idle」決定 SPIN 是否可互動。
     */
    private refreshSpinInteractable(): void {
        const connected = !!(this.ws && this.ws.isConnected());
        const idle = !this.fsm || this.fsm.getState() === SlotState.Idle;
        const inFlight = !!(this.ws && this.ws.isSpinInFlight());
        this.setSpinInteractable(connected && idle && !inFlight);
    }

    /**
     * 設定 SPIN 按鈕可互動狀態。
     */
    private setSpinInteractable(interactable: boolean): void {
        if (this.spinButton) {
            this.spinButton.interactable = interactable;
        }
    }

    /**
     * 在狀態 Label 顯示訊息（沒綁 Label 時僅由呼叫端的 console 負責）。
     * 空字串＝清除訊息。
     */
    private showStatus(text: string): void {
        if (this.statusLabel) {
            this.statusLabel.string = text;
        }
    }
}
