import { _decorator, Component } from 'cc';
import type { ErrorCode, ServerMessage, SessionInit, SpinResult } from './SlotProtocol';
const { ccclass, property } = _decorator;

/**
 * SpinError
 * requestSpin 失敗時 reject 的錯誤物件，帶一個分類碼讓上層給對應繁中訊息。
 * code 可能是伺服器的 ErrorCode，或客戶端自訂的 'TIMEOUT' / 'DISCONNECTED' / 'NOT_CONNECTED' / 'BUSY'。
 */
export type SpinErrorCode = ErrorCode | 'TIMEOUT' | 'DISCONNECTED' | 'NOT_CONNECTED' | 'BUSY';

export class SpinError extends Error {
    public readonly code: SpinErrorCode;
    constructor(code: SpinErrorCode, message: string) {
        super(message);
        this.name = 'SpinError';
        this.code = code;
    }
}

/**
 * SlotWebSocket
 * 客戶端與 WebSocket 伺服器的連線管理元件（掛在常駐節點）。
 * 職責：
 *   - connect()：建立連線，收到 sessionInit 後觸發 onSessionInit 回呼。
 *   - requestSpin(betMinor)：送出 spin 請求並等對應回應，回傳可 await 的 SpinResult；
 *     伺服器回 error → reject（帶 code）；逾時 → reject；斷線 → reject。
 *   - 連線狀態回呼 onConnected / onDisconnected。
 *   - 斷線自動指數退避重連；絕不自動重送 spin（避免重複扣款）。
 * 零信任：本元件只負責傳輸，不計算任何金額或中獎。
 *
 * 【已知限制 / 開發期行為】
 *   伺服器餘額存在記憶體、無登入；重連通常是「新 session」→ 餘額會重置為初始值。
 *   這是開發期行為；上線前必須補 認證（auth）＋ 帳戶持久化，重連才能還原同一玩家餘額。
 */
@ccclass('SlotWebSocket')
export class SlotWebSocket extends Component {
    // 伺服器位址（可在 Inspector 改，不寫死在邏輯深處）。
    @property
    public serverUrl: string = 'ws://127.0.0.1:8080';

    // 單次 spin 的逾時毫秒數；超過即 reject（TIMEOUT）。
    @property
    public spinTimeoutMs: number = 5000;

    // 重連退避上限（毫秒）。退避序列 1s → 2s → 4s …，封頂於此值。
    @property
    public reconnectMaxMs: number = 10000;

    // ─── 對外回呼（由 GameFlow 註冊）────────────────────────────────────
    // 收到 sessionInit 時呼叫（帶初始餘額等）。
    public onSessionInit: ((init: SessionInit) => void) | null = null;
    // 連線成功（WebSocket open）時呼叫。
    public onConnected: (() => void) | null = null;
    // 連線中斷（close / error）時呼叫。
    public onDisconnected: (() => void) | null = null;

    // 底層 WebSocket 實例（瀏覽器 runtime 的全域 WebSocket）。
    private _ws: WebSocket | null = null;

    // 目前的 sessionToken（每次 sessionInit 更新）；送 spin 時帶上。
    private _sessionToken: string | null = null;

    // 是否已連上（收到 open）。
    private _connected: boolean = false;

    // 是否為「主動關閉」（元件銷毀時），用來避免銷毀後還排程重連。
    private _closedByUs: boolean = false;

    // 下一次重連的退避毫秒數（指數成長、封頂 reconnectMaxMs）。
    private _reconnectDelayMs: number = 1000;

    // 進行中的重連排程 id（scheduleOnce 用 callback 參照，故記旗標即可）。
    private _reconnectScheduled: boolean = false;

    // ─── 進行中的 spin 請求（single-flight：同時只允許一個）─────────────
    private _pending: {
        resolve: (r: SpinResult) => void;
        reject: (e: SpinError) => void;
        timer: ReturnType<typeof setTimeout> | null;
    } | null = null;

    /** 是否已連上伺服器。 */
    public isConnected(): boolean {
        return this._connected;
    }

    /** 是否有未完成的 spin 請求。 */
    public isSpinInFlight(): boolean {
        return this._pending !== null;
    }

    /**
     * 建立連線。重複呼叫時若已有連線則忽略。
     */
    public connect(): void {
        if (this._ws !== null) {
            return;
        }
        this.openSocket();
    }

    /**
     * 實際開啟 WebSocket 並掛上事件。
     */
    private openSocket(): void {
        this._closedByUs = false;
        try {
            const ws = new WebSocket(this.serverUrl);
            this._ws = ws;

            ws.onopen = () => {
                this._connected = true;
                // 連上後重設退避。
                this._reconnectDelayMs = 1000;
                console.log(`[SlotWebSocket] 已連線：${this.serverUrl}`);
                if (this.onConnected) {
                    this.onConnected();
                }
            };

            ws.onmessage = (ev: MessageEvent) => {
                this.handleRawMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
            };

            ws.onerror = () => {
                // onerror 後通常緊跟 onclose；統一在 onclose 處理狀態與重連。
                console.warn('[SlotWebSocket] 連線錯誤');
            };

            ws.onclose = () => {
                this.handleClose();
            };
        } catch (e) {
            console.warn('[SlotWebSocket] 建立 WebSocket 失敗：', e);
            this.handleClose();
        }
    }

    /**
     * 處理收到的原始訊息字串：解析 JSON、依 action 分派。
     */
    private handleRawMessage(text: string): void {
        let msg: ServerMessage;
        try {
            msg = JSON.parse(text) as ServerMessage;
        } catch {
            console.warn('[SlotWebSocket] 收到無法解析的訊息：', text);
            return;
        }

        switch (msg.action) {
            case 'sessionInit':
                this._sessionToken = msg.sessionToken;
                if (this.onSessionInit) {
                    this.onSessionInit(msg);
                }
                break;
            case 'spinResult':
                this.resolvePending(msg);
                break;
            case 'error':
                this.rejectPending(new SpinError(msg.code, msg.message));
                break;
            default:
                console.warn('[SlotWebSocket] 收到未知 action：', (msg as { action?: string }).action);
        }
    }

    /**
     * 送出 spin 請求並回傳可 await 的 SpinResult。
     * single-flight：已有未完成請求時直接 reject（BUSY）。
     * 未連線時 reject（NOT_CONNECTED）。逾時 reject（TIMEOUT）。
     * @param betMinor 總注（Minor_Unit 整數）
     */
    public requestSpin(betMinor: number): Promise<SpinResult> {
        return new Promise<SpinResult>((resolve, reject) => {
            if (this._pending !== null) {
                reject(new SpinError('BUSY', '上一次 spin 尚未完成'));
                return;
            }
            if (!this._connected || !this._ws || this._sessionToken === null) {
                reject(new SpinError('NOT_CONNECTED', '尚未連線到伺服器'));
                return;
            }

            // 逾時計時：到時 reject 並清掉 pending。
            const timer = setTimeout(() => {
                this.rejectPending(new SpinError('TIMEOUT', '伺服器回應逾時'));
            }, this.spinTimeoutMs);

            this._pending = { resolve, reject, timer };

            const req = {
                action: 'spin' as const,
                sessionToken: this._sessionToken,
                betAmount: betMinor,
            };
            try {
                this._ws.send(JSON.stringify(req));
            } catch (e) {
                // 送出失敗（例如剛好斷線）：清掉 pending 並 reject。
                this.rejectPending(new SpinError('DISCONNECTED', '送出請求時連線中斷'));
            }
        });
    }

    /**
     * 以 spinResult 完成進行中的請求。
     */
    private resolvePending(result: SpinResult): void {
        const pending = this._pending;
        if (!pending) {
            // 沒有對應請求（例如逾時後才到）；忽略。
            return;
        }
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        this._pending = null;
        pending.resolve(result);
    }

    /**
     * 以錯誤 reject 進行中的請求。
     */
    private rejectPending(err: SpinError): void {
        const pending = this._pending;
        if (!pending) {
            return;
        }
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        this._pending = null;
        pending.reject(err);
    }

    /**
     * 連線關閉處理：更新狀態、reject 進行中的 spin（絕不自動重送）、排程重連。
     */
    private handleClose(): void {
        const wasConnected = this._connected;
        this._connected = false;
        this._ws = null;
        this._sessionToken = null;

        // 進行中的 spin 一律 reject：斷線時不知道伺服器是否已結算，
        // 絕不自動重送（避免重複扣款）；由 UI 顯示「連線中斷」。
        this.rejectPending(new SpinError('DISCONNECTED', '連線中斷'));

        if (wasConnected && this.onDisconnected) {
            this.onDisconnected();
        }

        // 非主動關閉才排程重連。
        if (!this._closedByUs) {
            this.scheduleReconnect();
        }
    }

    /**
     * 指數退避排程重連：1s → 2s → 4s …，封頂 reconnectMaxMs。
     */
    private scheduleReconnect(): void {
        if (this._reconnectScheduled) {
            return;
        }
        this._reconnectScheduled = true;
        const delaySec = this._reconnectDelayMs / 1000;
        console.log(`[SlotWebSocket] ${delaySec} 秒後嘗試重連`);
        this.scheduleOnce(() => {
            this._reconnectScheduled = false;
            // 下一次退避加倍、封頂。
            this._reconnectDelayMs = Math.min(this._reconnectDelayMs * 2, this.reconnectMaxMs);
            if (!this._closedByUs) {
                this.openSocket();
            }
        }, delaySec);
    }

    /**
     * 元件銷毀：主動關閉連線、reject 進行中的請求、不再重連。
     */
    onDestroy() {
        this._closedByUs = true;
        this.rejectPending(new SpinError('DISCONNECTED', '元件銷毀，連線關閉'));
        if (this._ws) {
            // 清掉 handler 避免 onclose 再觸發重連。
            this._ws.onopen = null;
            this._ws.onmessage = null;
            this._ws.onerror = null;
            this._ws.onclose = null;
            try {
                this._ws.close();
            } catch {
                // 忽略關閉時的例外。
            }
            this._ws = null;
        }
        this._connected = false;
    }
}
