import { WinLineInfo } from '../WinLineHighlighter';

/**
 * SlotProtocol
 * 客戶端用的 WebSocket 協定型別，欄位名與型別一律照抄伺服器原始碼
 * （slot-math-engine-server/src/protocol/messages.ts 與引擎 types.ts），
 * 不自行發明或猜測欄位。本檔只定義型別與「純格式轉換」函式，無副作用、不連網路、
 * 不計算任何金額或中獎（零信任：中不中由伺服器決定）。
 *
 * 已知事實（偵查確認）：
 *   - grid[col][row]，5×3，row 0 = 畫面最上方（GDD：0=上、1=中、2=下）。
 *   - winLine.positions / scatterResult.positions 皆為 [col, row][]（0-based，含 WILD 格）。
 */

// ─── 引擎原始型別（照抄 engine types.ts）────────────────────────────────

/** 盤面：grid[col][row]，0-based。對應伺服器 Grid = string[][]。 */
export type Grid = string[][];

/** 座標 tuple：[col, row]。對應伺服器 Position = [col, row]。 */
export type Position = [col: number, row: number];

/** 單條中獎線。對應伺服器 WinLine。positions 為構成連線的前 N 格 [col,row]（含 WILD 格）。 */
export interface WinLine {
    readonly line: number;        // 線號 1..betLines
    readonly symbol: string;      // 線符號（不會是 WILD 或 SCATTER）
    readonly count: number;       // 連數 N
    readonly payout: number;      // 已含倍數的線獎金額（Minor_Unit）
    readonly positions: Position[]; // 前 N 格座標 [col, row]
}

/** Scatter 結算。對應伺服器 ScatterResult。positions 為各 SCATTER 的 [col,row]。 */
export interface ScatterResult {
    readonly count: number;
    readonly positions: Position[];
    readonly payout: number;          // 已含倍數的 scatter 獎金（Minor_Unit）
    readonly freeSpinsAwarded: number; // > 0 表示觸發 FS
}

// ─── server→client 訊息（照抄 messages.ts）──────────────────────────────

/** 連線建立後的第一則訊息。 */
export interface SessionInit {
    readonly action: 'sessionInit';
    readonly sessionToken: string; // ≥128 位元隨機憑證（實測為 64 hex 字元）
    readonly balance: number;      // 初始餘額（Minor_Unit）
    readonly reels: number;        // 現值 5
    readonly rows: number;         // 現值 3
    readonly betLines: number;     // 現值 20
}

/** Free Spins 子回合的投影視圖（5a 只讀不演出）。 */
export interface FreeSpinView {
    readonly grid: Grid;
    readonly stops: readonly number[];
    readonly winLines: readonly WinLine[];
    readonly scatterResult: ScatterResult;
    readonly totalWin: number; // 已含 fsMultiplier
}

/** 一次成功 spin 的整輪結果。頂層 grid/winLines/scatterResult 為 Base_Spin 的值。 */
export interface SpinResult {
    readonly action: 'spinResult';
    readonly grid: Grid;                       // = baseSpin.grid
    readonly stops: readonly number[];         // = baseSpin.stops
    readonly winLines: readonly WinLine[];     // = baseSpin.winLines
    readonly scatterResult: ScatterResult;     // = baseSpin.scatterResult
    readonly baseWin: number;                  // = baseSpin.totalWin
    readonly freeSpinsWin: number;             // Σ 各 FS totalWin
    readonly totalWin: number;                 // 整輪總贏分（含 FS）
    readonly freeSpins: readonly FreeSpinView[];
    readonly totalFreeSpins: number;           // = freeSpins.length
    readonly freeSpinsRemaining: 0;            // 伺服器型別固定為 0
    readonly balance: number;                  // 本輪結算後餘額（Minor_Unit）
}

/** 伺服器的 7 個 Error_Code（照抄 messages.ts ERROR_CODES）。 */
export type ErrorCode =
    | 'INVALID_MESSAGE'
    | 'UNKNOWN_ACTION'
    | 'INVALID_SESSION'
    | 'INVALID_BET'
    | 'INSUFFICIENT_BALANCE'
    | 'RATE_LIMITED'
    | 'INTERNAL_ERROR';

/** 錯誤回應。 */
export interface ErrorMessage {
    readonly action: 'error';
    readonly code: ErrorCode;
    readonly message: string; // 伺服器的固定繁體中文文案
}

/** 任一 server→client 訊息（以 action 判別）。 */
export type ServerMessage = SessionInit | SpinResult | ErrorMessage;

// ─── client→server 訊息（照抄 messages.ts）──────────────────────────────

/** spin 請求。bet 為總注（Minor_Unit 整數，須可被 betLines 整除且 ≤ 餘額）。 */
export interface SpinRequest {
    readonly action: 'spin';
    readonly sessionToken: string;
    readonly betAmount: number;
}

// ─── 純格式轉換（無副作用）────────────────────────────────────────────

/**
 * 把伺服器 SpinResult 的中獎資料轉成客戶端高亮用的 WinLineInfo[]。
 * - 每條 winLine 的 positions（[col,row]）→ { reel: col, row }（含 WILD 格，照伺服器給的）。
 * - 若 scatter 有中獎（依伺服器欄位判斷：positions 非空且 payout > 0），額外加一筆
 *   以 scatter positions 組成的 WinLineInfo。
 * 零信任：只做格式轉換，不自行判斷中不中獎——伺服器說中的（有列進 positions）才轉。
 * @param result 伺服器回傳的整輪結果
 * @returns 給 WinLineHighlighter.highlight 用的 WinLineInfo 陣列
 */
export function toWinLineInfos(result: SpinResult): WinLineInfo[] {
    const infos: WinLineInfo[] = [];

    // 線獎：每條 winLine 的 positions 直接映成 cells。
    for (const line of result.winLines) {
        const cells = line.positions.map(([col, row]) => ({ reel: col, row }));
        infos.push({ cells });
    }

    // Scatter 獎：伺服器判定有中（有座標且有賠付）才高亮。
    const scatter = result.scatterResult;
    if (scatter && scatter.positions.length > 0 && scatter.payout > 0) {
        const cells = scatter.positions.map(([col, row]) => ({ reel: col, row }));
        infos.push({ cells });
    }

    return infos;
}
