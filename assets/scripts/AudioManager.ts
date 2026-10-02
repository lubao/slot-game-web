import { _decorator, Component, AudioSource, AudioClip } from 'cc';
const { ccclass, property } = _decorator;

/**
 * AudioManager
 * 音效管理元件，掛在常駐節點（例如 Canvas 或新建的 AudioRoot）。
 * 以單例（static instance）方式取用，供流程控制器（SpinController）呼叫。
 * 職責：
 *   播放轉動 / 停輪 / 中獎音效與背景音樂，管理音量與靜音。
 * 佔位說明：目前綁的是合成佔位音檔（assets/audio/*.wav），
 *   之後換正式素材只需替換檔案、重綁 @property AudioClip，本介面不變。
 * 不做任何遊戲邏輯。
 */
@ccclass('AudioManager')
export class AudioManager extends Component {
    // 單例參照，方便其他元件以 AudioManager.instance 取用。
    public static instance: AudioManager | null = null;

    // 轉動音效（短 whoosh）。
    @property(AudioClip)
    public spinSfx: AudioClip | null = null;

    // 停輪音效（click）。
    @property(AudioClip)
    public stopSfx: AudioClip | null = null;

    // 中獎音效（上揚叮）。
    @property(AudioClip)
    public winSfx: AudioClip | null = null;

    // 背景音樂（可 loop 的一小段）。
    @property(AudioClip)
    public bgm: AudioClip | null = null;

    // 背景音樂音量（0 ~ 1）。
    @property
    public bgmVolume: number = 0.4;

    // 音效音量（0 ~ 1）。
    @property
    public sfxVolume: number = 0.8;

    // 是否靜音（為 true 時所有播放都不出聲）。
    @property
    public muted: boolean = false;

    // 專門播背景音樂的 AudioSource（loop）。於 onLoad 建立。
    private _bgmSource: AudioSource | null = null;

    // 專門播一次性音效的 AudioSource（playOneShot）。於 onLoad 建立。
    private _sfxSource: AudioSource | null = null;

    /**
     * 建立單例與兩個 AudioSource（一個給 BGM、一個給 SFX）。
     */
    onLoad() {
        AudioManager.instance = this;

        // BGM 用的 AudioSource：loop 播放，單獨一個以免被 SFX 打斷。
        this._bgmSource = this.node.addComponent(AudioSource);
        this._bgmSource.loop = true;
        this._bgmSource.playOnAwake = false;

        // SFX 用的 AudioSource：以 playOneShot 疊放短音效。
        this._sfxSource = this.node.addComponent(AudioSource);
        this._sfxSource.loop = false;
        this._sfxSource.playOnAwake = false;
    }

    /**
     * 元件銷毀時清掉單例參照，避免殘留指向失效元件。
     */
    onDestroy() {
        if (AudioManager.instance === this) {
            AudioManager.instance = null;
        }
    }

    /**
     * 播放轉動音效。
     */
    public playSpin(): void {
        this.playOneShot(this.spinSfx);
    }

    /**
     * 播放停輪音效。
     * （可每欄停輪各播一次，或只在最後一欄播，由呼叫方決定呼叫時機。）
     */
    public playStop(): void {
        this.playOneShot(this.stopSfx);
    }

    /**
     * 播放中獎音效。
     */
    public playWin(): void {
        this.playOneShot(this.winSfx);
    }

    /**
     * 開始播放背景音樂（loop）。
     * 若已在播放則重設音量後繼續；靜音時音量為 0 但仍進行播放狀態。
     */
    public playBgm(): void {
        if (!this._bgmSource || !this.bgm) {
            return;
        }
        this._bgmSource.clip = this.bgm;
        this._bgmSource.loop = true;
        this._bgmSource.volume = this.muted ? 0 : this.bgmVolume;
        if (!this._bgmSource.playing) {
            this._bgmSource.play();
        }
    }

    /**
     * 停止背景音樂。
     */
    public stopBgm(): void {
        if (this._bgmSource) {
            this._bgmSource.stop();
        }
    }

    /**
     * 設定靜音狀態。
     * 立即套用到 BGM 音量（SFX 於下次播放時依 muted 判斷）。
     * @param b 是否靜音
     */
    public setMuted(b: boolean): void {
        this.muted = b;
        if (this._bgmSource) {
            this._bgmSource.volume = b ? 0 : this.bgmVolume;
        }
    }

    /**
     * 以 playOneShot 播放一個一次性音效，套用 sfxVolume 與靜音判斷。
     * @param clip 要播放的音檔；為空或靜音時不播放
     */
    private playOneShot(clip: AudioClip | null): void {
        if (!this._sfxSource || !clip || this.muted) {
            return;
        }
        this._sfxSource.playOneShot(clip, this.sfxVolume);
    }
}
