import { _decorator, Component } from 'cc';
import { ReelSpinner } from './ReelSpinner';
import { ReelView } from './ReelView';
import { SlotStateMachine, SlotState } from './SlotStateMachine';
import { SlotUI } from './SlotUI';
import { WinLineHighlighter, WinLineInfo } from './WinLineHighlighter';
import { AudioManager } from './AudioManager';
import type { SpinResult } from './net/SlotProtocol';
const { ccclass, property } = _decorator;

/**
 * SpinController
 * 串起「狀態機 + 5 個轉輪」的流程控制器，掛在 ReelRoot 上。
 * 職責：
 *   收到一次 playRound(grid) 呼叫後，推進狀態機並依序驅動 5 個 ReelSpinner，
 *   完成「同時起轉 → 依序停輪 → 顯示結果 → 回到待機」的一輪流程。
 * 本元件不連網路、不算獎金；grid 由呼叫方提供（Phase 5 會改由伺服器提供）。
 */
@ccclass('SpinController')
export class SpinController extends Component {
    // 5 個轉輪的 ReelSpinner，依序對應 Reel_0 ~ Reel_4（在 Inspector 拖進來）。
    @property({ type: [ReelSpinner] })
    public reels: ReelSpinner[] = [];

    // 遊戲流程狀態機（在 Inspector 拖進來）。
    @property(SlotStateMachine)
    public fsm: SlotStateMachine | null = null;

    // UI 顯示元件（在 Inspector 拖 UILayer 上的 SlotUI 進來）。
    // 負責餘額 / 下注 / 贏分三個 Label 的顯示與贏分跳動；本控制器只呼叫它更新顯示。
    @property(SlotUI)
    public slotUI: SlotUI | null = null;

    // 中獎符號高亮元件（在 Inspector 拖 ReelRoot 上的 WinLineHighlighter 進來）。
    // 本控制器只負責在 ShowResult 把外部傳入的 winLines 餵給它，不自行判斷中獎。
    @property(WinLineHighlighter)
    public winHighlighter: WinLineHighlighter | null = null;

    // 音效管理元件（在 Inspector 拖常駐節點上的 AudioManager 進來）。
    @property(AudioManager)
    public audio: AudioManager | null = null;

    // 全部轉輪一起滾動的時間（毫秒），時間到才開始依序停輪。
    @property
    public spinDurationMs: number = 800;

    // 相鄰兩欄停輪的間隔（毫秒），營造由左至右依序停下的節奏。
    @property
    public reelStopIntervalMs: number = 200;

    // 全部停穩後、進入 ShowResult 的停留時間（毫秒），之後才回到 Idle。
    @property
    public showResultMs: number = 600;

    // 是否在遊戲啟動時自動播放背景音樂（loop）。
    @property
    public playBgmOnStart: boolean = true;

    /**
     * 啟動時（可選）開始播放背景音樂。
     * 註：瀏覽器對自動播放有限制，首次互動（點 SPIN）後才一定出聲是正常現象。
     */
    start() {
        if (this.playBgmOnStart && this.audio) {
            this.audio.playBgm();
        }
    }

    /**
     * 執行一輪遊戲流程。
     * 流程：
     *   0. 若目前不是 Idle 就忽略（防連點 / 重入）。
     *   1. fsm.toSpinning()，5 個轉輪同時 startSpin()。
     *   2. 等 spinDurationMs 的轉動時間。
     *   3. fsm.toEvaluating()，由 Reel_0 起依序 stopSpin(grid[i])，每欄間隔 reelStopIntervalMs，
     *      並等每一欄的回彈動畫停穩。
     *   4. 全部停穩後 fsm.toShowResult()，停留 showResultMs 後 fsm.toIdle()。
     * 另外在既有流程點掛上音效與中獎高亮（side-effect，不改狀態轉移與計時）：
     *   進 Spinning：playSpin() + clearHighlight()；每欄停輪：playStop()；
     *   進 ShowResult：若有 winLines 則 playWin() + highlight(winLines)。
     * 零信任：grid、winLines、金額一律由伺服器提供（透過 result 傳入）；
     *   客戶端永遠不自己判斷中獎、不自己計算金額。
     * 金額顯示（Phase 5a）：只用伺服器 result 的數字推導——
     *   開轉時顯示 result.balance − result.totalWin（已扣注、尚未派彩的餘額），
     *   ShowResult 時 showWin(result.totalWin) 滾動 + 高亮，結束後 setBalance(result.balance)。
     * @param grid 伺服器盤面，grid[col][row]（col 對應 Reel_col），直接餵、不轉換
     * @param winLines 中獎線資料（由 toWinLineInfos 從伺服器結果轉來；空陣列＝不高亮）
     * @param result 伺服器整輪結果；只讀其 balance 與 totalWin 做顯示，不做任何計算
     */
    public async playRound(
        grid: string[][],
        winLines: WinLineInfo[] = [],
        result: SpinResult,
    ): Promise<void> {
        // 0. 防連點：非 Idle 一律忽略
        if (!this.fsm) {
            console.warn('[SpinController] 未綁定 SlotStateMachine，無法執行 playRound');
            return;
        }
        if (this.fsm.getState() !== SlotState.Idle) {
            console.warn(`[SpinController] 目前非 Idle（${this.fsm.getState()}），忽略本次 playRound`);
            return;
        }

        // 基本檢查：需要 5 欄資料
        if (!grid || grid.length < this.reels.length) {
            console.warn('[SpinController] grid 欄數不足，無法執行 playRound');
            return;
        }

        // 進 Spinning 前的 UI 更新：重置贏分顯示，並顯示「已扣注、尚未派彩」的餘額。
        // 零信任：這個值完全由伺服器數字推得（result.balance − result.totalWin），
        //   不是客戶端自己算的——伺服器 balance 已含本輪派彩，減掉 totalWin 即為扣注後、派彩前的餘額。
        if (this.slotUI) {
            this.slotUI.resetWin();
            this.slotUI.setBalance(result.balance - result.totalWin);
        }

        // side-effect：進 Spinning 前先清掉上一輪的中獎高亮，並播放轉動音效。
        if (this.winHighlighter) {
            this.winHighlighter.clearHighlight();
        }
        if (this.audio) {
            this.audio.playSpin();
        }

        // 1. 進入 Spinning，全部轉輪同時起轉
        this.fsm.toSpinning();
        for (const reel of this.reels) {
            if (reel) {
                reel.startSpin();
            }
        }

        // 2. 等待轉動時間
        await this.delay(this.spinDurationMs);

        // 3. 進入 Evaluating，依序停輪
        this.fsm.toEvaluating();
        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            const column = grid[i];
            if (reel && column) {
                // 等這一欄停穩（含回彈）再處理下一欄，形成依序停下的手感。
                await reel.stopSpin(column);
                // side-effect：每一欄停穩時播一次停輪音效。
                if (this.audio) {
                    this.audio.playStop();
                }
            }
            // 欄與欄之間再稍等一下（最後一欄不需要）。
            if (i < this.reels.length - 1) {
                await this.delay(this.reelStopIntervalMs);
            }
        }

        // 4. 全部停穩：顯示結果
        this.fsm.toShowResult();

        // side-effect：若這一輪有中獎線，播中獎音效並高亮中獎格子。
        // 零信任：winLines 由外部傳入（Phase 5 為伺服器回傳），本控制器不自行判斷中獎。
        const hasWinLines = !!(winLines && winLines.length > 0);
        if (hasWinLines && this.audio) {
            this.audio.playWin();
        }

        // 進 ShowResult 時的 UI 更新：贏分數字跳動與中獎高亮「同時」進行，等兩者都播完。
        const effects: Promise<void>[] = [];

        if (this.slotUI) {
            // 贏分數字從 0 滾動到伺服器的 totalWin（整輪總贏分，含 FS），與高亮併行。
            // 零信任：totalWin 直接取伺服器值，不做任何計算。
            effects.push(this.slotUI.showWin(result.totalWin).then(() => {
                // 動畫播完後，餘額顯示直接設為伺服器回傳的結算後餘額。
                this.slotUI!.setBalance(result.balance);
            }));
        }

        // 中獎高亮（與贏分跳動併行）。沒有 winLines 時 highlight 內部會直接結束。
        if (hasWinLines && this.winHighlighter) {
            effects.push(this.winHighlighter.highlight(winLines));
        }

        // 等贏分跳動與高亮都完成。
        await Promise.all(effects);

        // 5. 停留 → 回到待機
        await this.delay(this.showResultMs);
        this.fsm.toIdle();
    }

    /**
     * 開場裝飾盤面：把一組靜態符號排到 5 欄上。
     * 僅供開場畫面好看，不代表任何結果；第一次 spin 後即被伺服器 grid 取代。
     * 由 GameFlow 在 start() 呼叫一次。
     * @param grid 5 欄 x 每欄符號 ID（grid[col][row]，row 0 在最上方）
     */
    public showInitialDisplay(grid: string[][]): void {
        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            const column = grid[i];
            if (!reel || !column) {
                continue;
            }
            const view = reel.getComponent(ReelView);
            if (view) {
                view.setColumn(column);
            }
        }
    }

    /**
     * 以 Cocos 排程器實作的可 await 延遲。
     * 用元件的 scheduleOnce 而非原生 setTimeout，能隨場景暫停 / 節點銷毀一起被管理。
     * @param ms 延遲毫秒數
     */
    private delay(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.scheduleOnce(() => resolve(), ms / 1000);
        });
    }
}
