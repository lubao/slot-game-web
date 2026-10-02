import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;

/**
 * SlotState
 * 老虎機一輪遊戲流程的四個狀態。
 * 合法轉移路線（單向循環）：
 *   Idle → Spinning → Evaluating → ShowResult → Idle
 */
export enum SlotState {
    Idle = 'Idle',             // 待機：可接受下一次 Spin
    Spinning = 'Spinning',     // 轉動中：轉輪正在滾動
    Evaluating = 'Evaluating', // 結算中：逐欄停輪、對齊最終盤面
    ShowResult = 'ShowResult', // 顯示結果：停留展示（本階段不算獎金）
}

/**
 * SlotStateMachine
 * 純粹的遊戲流程狀態機元件。
 * 只負責維護「目前狀態」與「合法轉移」，
 * 不放任何遊戲邏輯、動畫或獎金計算。
 * 其他元件（如 SpinController）透過受控轉移方法推進狀態，
 * 並可註冊 onStateChange 回呼以在狀態變動時收到通知。
 */
@ccclass('SlotStateMachine')
export class SlotStateMachine extends Component {
    // 目前狀態，預設為 Idle（待機）。
    private _state: SlotState = SlotState.Idle;

    // 狀態變動回呼清單。狀態每次成功轉移後，會依序呼叫這些回呼。
    // 參數為 (新狀態, 舊狀態)，方便訂閱者做對應處理。
    private _listeners: Array<(next: SlotState, prev: SlotState) => void> = [];

    // 合法轉移表：key 為目前狀態，value 為允許進入的下一個狀態。
    // 本狀態機採單一路線，因此每個狀態只有一個合法後繼。
    private static readonly ALLOWED: Record<SlotState, SlotState> = {
        [SlotState.Idle]: SlotState.Spinning,
        [SlotState.Spinning]: SlotState.Evaluating,
        [SlotState.Evaluating]: SlotState.ShowResult,
        [SlotState.ShowResult]: SlotState.Idle,
    };

    /**
     * 取得目前狀態。
     */
    public getState(): SlotState {
        return this._state;
    }

    /**
     * 註冊狀態變動回呼。
     * @param cb 狀態成功轉移後被呼叫，參數為 (新狀態, 舊狀態)。
     */
    public onStateChange(cb: (next: SlotState, prev: SlotState) => void): void {
        if (cb && this._listeners.indexOf(cb) < 0) {
            this._listeners.push(cb);
        }
    }

    /**
     * 取消註冊狀態變動回呼。
     * @param cb 先前以 onStateChange 註冊過的同一個函式參考。
     */
    public offStateChange(cb: (next: SlotState, prev: SlotState) => void): void {
        const idx = this._listeners.indexOf(cb);
        if (idx >= 0) {
            this._listeners.splice(idx, 1);
        }
    }

    /** 轉移到 Spinning（僅在 Idle 時合法）。 */
    public toSpinning(): boolean {
        return this.transition(SlotState.Spinning);
    }

    /** 轉移到 Evaluating（僅在 Spinning 時合法）。 */
    public toEvaluating(): boolean {
        return this.transition(SlotState.Evaluating);
    }

    /** 轉移到 ShowResult（僅在 Evaluating 時合法）。 */
    public toShowResult(): boolean {
        return this.transition(SlotState.ShowResult);
    }

    /** 轉移到 Idle（僅在 ShowResult 時合法）。 */
    public toIdle(): boolean {
        return this.transition(SlotState.Idle);
    }

    /**
     * 核心轉移邏輯：檢查目標狀態是否為目前狀態的合法後繼。
     * 合法則更新狀態並通知所有回呼；非法則印出 console.warn 並忽略。
     * @param next 想要進入的目標狀態
     * @returns 轉移是否成功
     */
    private transition(next: SlotState): boolean {
        const prev = this._state;
        const allowed = SlotStateMachine.ALLOWED[prev];

        // 非法轉移：印警告並忽略，不改變狀態。
        if (allowed !== next) {
            console.warn(`[SlotStateMachine] 非法轉移被忽略：${prev} → ${next}（合法後繼為 ${allowed}）`);
            return false;
        }

        // 合法轉移：更新狀態並廣播。
        this._state = next;
        console.log(`[SlotStateMachine] 狀態轉移：${prev} → ${next}`);
        this.emitStateChange(next, prev);
        return true;
    }

    /**
     * 依序呼叫所有已註冊的狀態變動回呼。
     * 個別回呼若拋出例外，僅印警告，不影響其他回呼。
     */
    private emitStateChange(next: SlotState, prev: SlotState): void {
        // 複製一份以避免回呼中途增刪造成迭代問題。
        const snapshot = this._listeners.slice();
        for (const cb of snapshot) {
            try {
                cb(next, prev);
            } catch (e) {
                console.warn('[SlotStateMachine] onStateChange 回呼發生例外：', e);
            }
        }
    }
}
