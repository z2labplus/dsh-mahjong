import { Client } from "./client";
import type { BloodState } from "./blood";
import { SoundInfo, SoundType } from "./types";
import { TILE_ACTION_VOICE_URLS, TILE_VOICE_URLS } from "./tile-voice-urls";

// @ts-ignore
import bgmInGameUrl from "url:../sound/huanle/playInGame.MP3";
// @ts-ignore
import sfxXiPaiUrl from "url:../sound/huanle/xipai.MP3";
// @ts-ignore
import sfxPengMUrl from "url:../sound/huanle/pengm.MP3";
// @ts-ignore
import sfxPengWUrl from "url:../sound/huanle/pengw.MP3";
// @ts-ignore
import sfxGangMUrl from "url:../sound/huanle/gangm.MP3";
// @ts-ignore
import sfxGangWUrl from "url:../sound/huanle/gangw.MP3";
// @ts-ignore
import sfxHuMUrl from "url:../sound/huanle/hum.MP3";
// @ts-ignore
import sfxHuWUrl from "url:../sound/huanle/huw.MP3";
// @ts-ignore
import sfxZiMoMUrl from "url:../sound/huanle/zimom.MP3";
// @ts-ignore
import sfxZiMoWUrl from "url:../sound/huanle/zimow.MP3";
// @ts-ignore
import sfxClickUrl from "url:../sound/huanle/click.MP3";
// @ts-ignore
import sfxChuPaiUrl from "url:../sound/huanle/chupai.MP3";
// @ts-ignore
import sfxChiMUrl from "url:../sound/huanle/chim.MP3";
// @ts-ignore
import sfxChiWUrl from "url:../sound/huanle/chiw.MP3";

type VoiceTag = "m" | "w";
type TileSuit = "m" | "p" | "s";
type TileActionVoice = keyof typeof TILE_ACTION_VOICE_URLS.m;

type BloodAudioSnapshot = {
  phase: string;
  wallIndex: number;
  handKey: string | null;
  meldSetBySeat: Array<Set<string>>;
  huBySeat: Array<boolean>;
  huSourceBySeat: Array<"self" | "discard" | null>;
};

function shouldUseWebAudio(): boolean {
  const ua = navigator.userAgent ?? "";
  const isIpadDesktopUa = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  const isMobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isIpadDesktopUa;
  return !isMobileUa;
}

class Channel {
  private elements: Record<string, HTMLAudioElement>;
  private panner: StereoPannerNode | null;
  private gainer: GainNode | null;
  private gainValue: number = 0.5;
  private panValue: number = 0;
  private playToken: number = 0;
  playing: boolean = false;

  constructor(audioContext: AudioContext | null, urls: Array<string>) {
    this.elements = {};
    this.gainer = audioContext ? audioContext.createGain() : null;
    this.panner = audioContext ? audioContext.createStereoPanner() : null;
    if (this.gainer && this.panner) {
      this.gainer.connect(this.panner).connect(audioContext!.destination);
    }

    for (const url of urls) {
      const element = document.createElement("audio");
      element.crossOrigin = "anonymous";
      element.src = url;
      element.preload = "auto";
      element.pause();
      if (audioContext && this.gainer) {
        try {
          const track = audioContext.createMediaElementSource(element);
          track.connect(this.gainer);
        } catch {
          // ignore
        }
      }
      this.elements[url] = element;
    }
  }

  gain(gain: number): void {
    this.gainValue = gain;
    if (this.gainer) {
      this.gainer.gain.value = gain;
    }
  }

  pan(pan: number): void {
    this.panValue = pan;
    if (this.panner) {
      this.panner.pan.value = pan;
    }
  }

  stop(): void {
    this.playToken += 1;
    for (const element of Object.values(this.elements)) {
      element.pause();
      try {
        element.currentTime = 0;
      } catch {
        // ignore
      }
      element.onended = null;
      element.onerror = null;
    }
    this.playing = false;
  }

  play(url: string, opts?: { onEnded?: () => void; onError?: () => void }): void {
    const element = this.elements[url];
    if (!element) {
      return;
    }
    this.stop();
    const token = this.playToken;
    if (!this.gainer) {
      element.volume = this.gainValue;
    }
    void this.panValue;
    element.onended = () => {
      if (this.playToken !== token) return;
      try {
        element.currentTime = 0;
      } catch {
        // ignore
      }
      this.playing = false;
      opts?.onEnded?.();
    };
    element.onerror = () => {
      if (this.playToken !== token) return;
      this.playing = false;
      opts?.onError?.();
    };
    try {
      element.currentTime = 0;
    } catch {
      // ignore
    }
    const promise = element.play();
    this.playing = true;
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {
        if (this.playToken !== token) return;
        this.playing = false;
        opts?.onError?.();
      });
    }
  }
}

export class SoundPlayer {
  private audioContext: AudioContext | null;
  private channels: Array<Channel>;
  private discardBaseChannel: Channel;
  private discardVoiceChannel: Channel;
  private client: Client;
  private fallbackStickUrl: string;
  private bgmElement: HTMLAudioElement;
  private bgmEnabled: boolean = true;
  private sfxEnabled: boolean = true;
  private bgmBlockedByAutoplay: boolean = false;
  private discardVoiceQueue: Array<{ url: string; side: number | null }> = [];
  private discardVoicePlaying: boolean = false;
  private voiceRoundKey: string | null = null;
  private voiceBySeat: Record<number, VoiceTag> = { 0: "w", 1: "m", 2: "w", 3: "m" };
  private bloodSnapshot: BloodAudioSnapshot | null = null;
  private lastDiscardPlayByKey: Map<string, number> = new Map();
  private lastDiscardTileVoiceByKey: Map<string, number> = new Map();
  private pointerClickArmed: boolean = false;
  private pointerClickNeedsReplay: boolean = false;
  private pointerClickClearTimer: number | null = null;
  muted: boolean = false;

  constructor(client: Client) {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const useWebAudio = shouldUseWebAudio();
    this.audioContext = useWebAudio && Ctx ? new Ctx() : null;
    this.client = client;
    this.client.sound.on("update", this.onUpdate.bind(this));
    this.client.blood.on("update", this.onBloodUpdate.bind(this));
    this.fallbackStickUrl = this.getSource("sound-stick");
    this.channels = [];

    const sfxUrls = this.channelUrls();
    for (let i = 0; i < 10; i++) {
      this.channels.push(new Channel(this.audioContext, sfxUrls));
    }
    this.discardBaseChannel = new Channel(this.audioContext, sfxUrls);
    this.discardVoiceChannel = new Channel(this.audioContext, this.voiceUrls());

    this.bgmElement = document.createElement("audio");
    this.bgmElement.crossOrigin = "anonymous";
    this.bgmElement.src = bgmInGameUrl;
    this.bgmElement.loop = true;
    this.bgmElement.preload = "auto";
    this.bgmElement.volume = 0.32;

    document.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    document.addEventListener("pointerup", this.onPointerUp, { capture: true });
    document.addEventListener("pointercancel", this.onPointerCancel, { capture: true });
    document.addEventListener("click", this.onDocumentClick, { capture: true });
    document.addEventListener("touchend", this.onTouchEnd, { capture: true, passive: true });
    this.syncBgmPlayback();
  }

  setPreferences(patch: { bgmEnabled?: boolean; sfxEnabled?: boolean }): void {
    if (typeof patch.bgmEnabled === "boolean") {
      this.bgmEnabled = patch.bgmEnabled;
    }
    if (typeof patch.sfxEnabled === "boolean") {
      this.sfxEnabled = patch.sfxEnabled;
    }
    this.syncBgmPlayback();
  }

  play(type: SoundType, side: number | null, tileKey: number | null = null, tileId: number | null = null): void {
    this.doPlay(type, side, this.client.seat, tileKey, tileId);
    if (type !== SoundType.DISCARD && this.client.seat !== null) {
      this.client.sound.set(0, { type, side, seat: this.client.seat });
    }
  }

  playLocalOnly(
    type: SoundType,
    side: number | null,
    actorSeat: number | null,
    tileKey: number | null = null,
    tileId: number | null = null
  ): void {
    this.doPlay(type, side, actorSeat, tileKey, tileId);
  }

  playDiscardTileVoiceLocalOnly(
    side: number | null,
    actorSeat: number | null,
    tileKey: number | null,
    tileId: number | null = null
  ): void {
    this.playDiscardTileVoice(side, actorSeat, tileKey, tileId);
  }

  playBuhuaLocalOnly(side: number | null, actorSeat: number | null): void {
    this.playActionVoice(side, actorSeat, "buhua");
  }

  private playLocal(
    type: SoundType,
    side: number | null,
    actorSeat: number | null,
    tileKey: number | null = null,
    tileId: number | null = null
  ): void {
    this.doPlay(type, side, actorSeat, tileKey, tileId);
  }

  private onUpdate(entries: Array<[number, SoundInfo | null]>): void {
    for (const [, sound] of entries) {
      if (sound !== null && sound.seat !== this.client.seat) {
        if (sound.type === SoundType.DISCARD) {
          // Discard SFX are driven by tile movement events so we can pick exact tile voice.
          continue;
        }
        this.doPlay(sound.type, sound.side, sound.seat, null);
      }
    }
  }

  private onBloodUpdate(): void {
    const state = this.client.blood.get(0) as BloodState | null;
    if (!state) {
      this.voiceRoundKey = null;
      this.bloodSnapshot = null;
      return;
    }
    const next = this.captureBloodAudioSnapshot(state);
    const prev = this.bloodSnapshot;

    if (next.handKey && next.handKey !== this.voiceRoundKey) {
      this.voiceRoundKey = next.handKey;
      this.voiceBySeat = this.randomizeSeatVoices(next.handKey);
    }

    const shouldPlayShuffle =
      next.phase === "playing" &&
      next.wallIndex === 0 &&
      next.handKey !== null &&
      (!prev || prev.phase !== "playing" || prev.handKey !== next.handKey);
    if (shouldPlayShuffle) {
      this.playLocal(SoundType.SHUFFLE, null, null);
    }

    if (prev) {
      for (let seat = 0; seat < 4; seat++) {
        const prevMelds = prev.meldSetBySeat[seat] ?? new Set<string>();
        const nextMelds = next.meldSetBySeat[seat] ?? new Set<string>();
        for (const sig of nextMelds) {
          if (prevMelds.has(sig)) continue;
          if (sig.startsWith("peng:")) {
            this.playLocal(SoundType.PENG, seat, seat);
          } else if (sig.startsWith("gang:")) {
            this.playLocal(SoundType.GANG, seat, seat);
          }
        }

        if (!(prev.huBySeat[seat] ?? false) && (next.huBySeat[seat] ?? false)) {
          if (next.huSourceBySeat[seat] === "self") {
            this.playZiMo(seat, seat);
          } else {
            this.playLocal(SoundType.HU, seat, seat);
          }
        }
      }
    }

    this.bloodSnapshot = next;
  }

  private captureBloodAudioSnapshot(state: BloodState): BloodAudioSnapshot {
    const meldSetBySeat: Array<Set<string>> = [new Set(), new Set(), new Set(), new Set()];
    const huBySeat: Array<boolean> = [false, false, false, false];
    const huSourceBySeat: Array<"self" | "discard" | null> = [null, null, null, null];
    for (let seat = 0; seat < 4; seat++) {
      const player = state.players?.[seat] ?? null;
      if (!player) continue;
      huBySeat[seat] = !!player.hu;
      huSourceBySeat[seat] = player.huSource ?? null;
      for (const meld of player.melds ?? []) {
        if (!meld) continue;
        meldSetBySeat[seat]!.add(`${meld.kind}:${meld.tileKey}:${meld.gangType ?? ""}:${meld.row}`);
      }
    }
    return {
      phase: String((state as any).phase ?? ""),
      wallIndex: Number.isFinite((state as any).wallIndex) ? Math.trunc((state as any).wallIndex) : 0,
      handKey: this.computeHandKey(state),
      meldSetBySeat,
      huBySeat,
      huSourceBySeat,
    };
  }

  private computeHandKey(state: BloodState): string | null {
    const wallOrder = Array.isArray((state as any).wallOrder) ? ((state as any).wallOrder as Array<number>) : [];
    if (wallOrder.length === 0) return null;
    let h = 2166136261 >>> 0;
    h = this.mixHash(h, Number.isFinite((state as any).dealer) ? Math.trunc((state as any).dealer) : 0);
    h = this.mixHash(h, wallOrder.length);
    for (const tileId of wallOrder) {
      h = this.mixHash(h, Number.isFinite(tileId) ? Math.trunc(tileId) : 0);
    }
    return `${wallOrder.length}:${h.toString(16)}`;
  }

  private mixHash(seed: number, value: number): number {
    let h = seed >>> 0;
    let v = value >>> 0;
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 16777619) >>> 0;
      v >>>= 8;
    }
    return h >>> 0;
  }

  private randomizeSeatVoices(roundKey: string): Record<number, VoiceTag> {
    const seats = [0, 1, 2, 3];
    let state = 2166136261 >>> 0;
    for (let i = 0; i < roundKey.length; i++) {
      state ^= roundKey.charCodeAt(i);
      state = Math.imul(state, 16777619) >>> 0;
    }
    const rand = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = seats[i]!;
      seats[i] = seats[j]!;
      seats[j] = tmp;
    }
    const maleSeats = new Set<number>(seats.slice(0, 2));
    return {
      0: maleSeats.has(0) ? "m" : "w",
      1: maleSeats.has(1) ? "m" : "w",
      2: maleSeats.has(2) ? "m" : "w",
      3: maleSeats.has(3) ? "m" : "w",
    };
  }

  private channelUrls(): Array<string> {
    const urls = new Set<string>();
    urls.add(sfxChuPaiUrl);
    urls.add(sfxClickUrl);
    urls.add(sfxXiPaiUrl);
    urls.add(sfxPengMUrl);
    urls.add(sfxPengWUrl);
    urls.add(sfxGangMUrl);
    urls.add(sfxGangWUrl);
    urls.add(sfxHuMUrl);
    urls.add(sfxHuWUrl);
    urls.add(sfxZiMoMUrl);
    urls.add(sfxZiMoWUrl);
    urls.add(sfxChiMUrl);
    urls.add(sfxChiWUrl);
    if (this.fallbackStickUrl) urls.add(this.fallbackStickUrl);
    return Array.from(urls);
  }

  private voiceUrls(): Array<string> {
    const urls = new Set<string>();
    for (const voiceTag of ["m", "w"] as const) {
      for (const url of Object.values(TILE_VOICE_URLS[voiceTag])) {
        urls.add(url);
      }
      for (const url of Object.values(TILE_ACTION_VOICE_URLS[voiceTag])) {
        urls.add(url);
      }
    }
    return Array.from(urls);
  }

  private getSource(id: string): string {
    const element = document.getElementById(id) as HTMLAudioElement | null;
    return element?.src ?? "";
  }

  private unlockAudioContext(): void {
    if (!this.audioContext) {
      return;
    }
    if (this.audioContext.state === "running") {
      return;
    }
    try {
      const promise = this.audioContext.resume();
      if (promise && typeof (promise as any).catch === "function") {
        (promise as any).catch(() => {
          // ignore
        });
      }
    } catch {
      // ignore
    }
  }

  private clearPointerClickArm(): void {
    this.pointerClickArmed = false;
    this.pointerClickNeedsReplay = false;
    if (this.pointerClickClearTimer !== null) {
      window.clearTimeout(this.pointerClickClearTimer);
      this.pointerClickClearTimer = null;
    }
  }

  private tryReplayArmedPointerClick(): void {
    if (!this.pointerClickArmed) {
      return;
    }
    if (!this.pointerClickNeedsReplay) {
      return;
    }
    this.pointerClickNeedsReplay = false;
    this.playLocal(SoundType.CLICK, null, null);
  }

  private armPointerClickClear(): void {
    if (this.pointerClickClearTimer !== null) {
      window.clearTimeout(this.pointerClickClearTimer);
    }
    this.pointerClickClearTimer = window.setTimeout(() => {
      this.pointerClickArmed = false;
      this.pointerClickNeedsReplay = false;
      this.pointerClickClearTimer = null;
    }, 1200);
  }

  private onTouchEnd = (): void => {
    this.unlockAudioContext();
    this.tryReplayArmedPointerClick();
    this.syncBgmPlayback();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== undefined && event.button !== 0) {
      return;
    }
    this.unlockAudioContext();
    this.pointerClickArmed = true;
    this.pointerClickNeedsReplay = false;
    if (this.pointerClickClearTimer !== null) {
      window.clearTimeout(this.pointerClickClearTimer);
      this.pointerClickClearTimer = null;
    }
    const contextRunning = !this.audioContext || this.audioContext.state === "running";
    if (contextRunning) {
      this.playLocal(SoundType.CLICK, null, null);
    } else {
      this.pointerClickNeedsReplay = true;
    }
    this.syncBgmPlayback();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== undefined && event.button !== 0) {
      return;
    }
    if (!this.pointerClickArmed) {
      return;
    }
    this.unlockAudioContext();
    this.tryReplayArmedPointerClick();
    this.syncBgmPlayback();
    this.armPointerClickClear();
  };

  private onPointerCancel = (): void => {
    this.clearPointerClickArm();
  };

  private onDocumentClick = (event: MouseEvent): void => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    this.unlockAudioContext();
    const isKeyboardClick = event.detail === 0;
    if (this.pointerClickArmed && !isKeyboardClick) {
      const shouldReplay = this.pointerClickNeedsReplay;
      this.clearPointerClickArm();
      if (shouldReplay) {
        this.playLocal(SoundType.CLICK, null, null);
      }
      this.syncBgmPlayback();
      return;
    }
    this.playLocal(SoundType.CLICK, null, null);
    this.syncBgmPlayback();
  };

  private syncBgmPlayback(): void {
    if (this.muted || !this.bgmEnabled) {
      this.bgmElement.pause();
      return;
    }
    const playPromise = this.bgmElement.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          this.bgmBlockedByAutoplay = false;
        })
        .catch(() => {
          this.bgmBlockedByAutoplay = true;
        });
    }
  }

  private voiceForSeat(seat: number | null): VoiceTag {
    if (seat === null || seat < 0 || seat > 3) return "w";
    return this.voiceBySeat[seat] ?? "w";
  }

  private tileVoiceKey(tileKey: number | null): string | null {
    if (tileKey === null || !Number.isFinite(tileKey)) return null;
    const k = Math.trunc(tileKey);
    if (k < 0 || k >= 34) return null;
    if (k >= 27) {
      return ["1z", "2z", "3z", "4z", "7z", "6z", "5z"][k - 27] ?? null;
    }
    const rank = (k % 9) + 1;
    const suit: TileSuit = k < 9 ? "m" : k < 18 ? "p" : "s";
    return `${rank}${suit}`;
  }

  private resolveDiscardTileVoiceUrl(tileKey: number | null, actorSeat: number | null): string | null {
    const key = this.tileVoiceKey(tileKey);
    if (!key) return null;
    const voiceTag = this.voiceForSeat(actorSeat);
    return TILE_VOICE_URLS[voiceTag][key] ?? null;
  }

  private resolveActionVoiceUrl(action: TileActionVoice, actorSeat: number | null): string | null {
    const voiceTag = this.voiceForSeat(actorSeat);
    return TILE_ACTION_VOICE_URLS[voiceTag][action] ?? null;
  }

  private toListenerPan(side: number | null): number {
    let pannedSide = side;
    const rotation = this.client.seat ?? 0;
    if (pannedSide !== null) {
      pannedSide = (pannedSide + 4 - rotation) % 4;
    }
    switch (pannedSide) {
      case 1:
        return 0.5;
      case 3:
        return -0.5;
      default:
        return 0;
    }
  }

  private resolveSfxUrl(type: SoundType, actorSeat: number | null): string {
    switch (type) {
      case SoundType.DISCARD:
        return sfxChuPaiUrl;
      case SoundType.STICK:
        return this.fallbackStickUrl || sfxChuPaiUrl;
      case SoundType.CLICK:
        return sfxClickUrl;
      case SoundType.SHUFFLE:
        return sfxXiPaiUrl;
      case SoundType.PENG:
        return this.voiceForSeat(actorSeat) === "m" ? sfxPengMUrl : sfxPengWUrl;
      case SoundType.GANG:
        return this.voiceForSeat(actorSeat) === "m" ? sfxGangMUrl : sfxGangWUrl;
      case SoundType.CHI:
        return this.voiceForSeat(actorSeat) === "m" ? sfxChiMUrl : sfxChiWUrl;
      case SoundType.HU:
        return this.voiceForSeat(actorSeat) === "m" ? sfxHuMUrl : sfxHuWUrl;
      default:
        return "";
    }
  }

  private resolveZiMoUrl(actorSeat: number | null): string {
    return this.voiceForSeat(actorSeat) === "m" ? sfxZiMoMUrl : sfxZiMoWUrl;
  }

  private playZiMo(side: number | null, actorSeat: number | null): void {
    if (this.muted || !this.sfxEnabled) {
      return;
    }
    this.unlockAudioContext();
    const url = this.resolveZiMoUrl(actorSeat);
    if (!url) {
      return;
    }
    for (const channel of this.channels) {
      if (!channel.playing) {
        channel.pan(this.toListenerPan(side));
        channel.gain(this.gainFor(SoundType.HU));
        channel.play(url);
        break;
      }
    }
  }

  private gainFor(type: SoundType): number {
    switch (type) {
      case SoundType.CLICK:
        return 0.34;
      case SoundType.SHUFFLE:
        return 0.58;
      default:
        return 0.5;
    }
  }

  private playDiscardSequence(side: number | null, actorSeat: number | null, tileKey: number | null, tileId: number | null): void {
    if (this.shouldSkipDuplicateDiscard(side, actorSeat, tileId)) {
      return;
    }
    this.discardBaseChannel.pan(this.toListenerPan(side));
    this.discardBaseChannel.gain(this.gainFor(SoundType.DISCARD));
    this.discardBaseChannel.play(sfxChuPaiUrl);
    this.playDiscardTileVoice(side, actorSeat, tileKey, tileId);
  }

  private playDiscardTileVoice(side: number | null, actorSeat: number | null, tileKey: number | null, tileId: number | null): void {
    if (this.muted || !this.sfxEnabled) {
      return;
    }
    this.unlockAudioContext();
    const tileVoiceUrl = this.resolveDiscardTileVoiceUrl(tileKey, actorSeat);
    if (!tileVoiceUrl) {
      return;
    }
    if (this.shouldSkipDuplicateDiscardTileVoice(side, actorSeat, tileId, tileKey)) {
      return;
    }
    this.enqueueDiscardVoice(side, tileVoiceUrl);
  }

  private playActionVoice(side: number | null, actorSeat: number | null, action: TileActionVoice): void {
    if (this.muted || !this.sfxEnabled) {
      return;
    }
    this.unlockAudioContext();
    const url = this.resolveActionVoiceUrl(action, actorSeat);
    if (!url) {
      return;
    }
    this.enqueueDiscardVoice(side, url);
  }

  private enqueueDiscardVoice(side: number | null, url: string): void {
    if (this.discardVoiceQueue.length >= 12) {
      this.discardVoiceQueue.shift();
    }
    this.discardVoiceQueue.push({ url, side });
    this.tryDrainDiscardTileVoiceQueue();
  }

  private tryDrainDiscardTileVoiceQueue(): void {
    if (this.discardVoicePlaying) {
      return;
    }
    const next = this.discardVoiceQueue.shift();
    if (!next) {
      return;
    }
    this.discardVoicePlaying = true;
    this.discardVoiceChannel.pan(this.toListenerPan(next.side));
    this.discardVoiceChannel.gain(this.gainFor(SoundType.DISCARD));
    this.discardVoiceChannel.play(next.url, {
      onEnded: () => {
        this.discardVoicePlaying = false;
        this.tryDrainDiscardTileVoiceQueue();
      },
      onError: () => {
        this.discardVoicePlaying = false;
        this.tryDrainDiscardTileVoiceQueue();
      },
    });
  }

  private doPlay(
    type: SoundType,
    side: number | null,
    actorSeat: number | null,
    tileKey: number | null = null,
    tileId: number | null = null
  ): void {
    if (this.muted || !this.sfxEnabled) {
      return;
    }
    this.unlockAudioContext();
    if (type === SoundType.DISCARD) {
      this.playDiscardSequence(side, actorSeat, tileKey, tileId);
      return;
    }
    const url = this.resolveSfxUrl(type, actorSeat);
    if (!url) {
      return;
    }

    for (const channel of this.channels) {
      if (!channel.playing) {
        channel.pan(this.toListenerPan(side));
        channel.gain(this.gainFor(type));
        channel.play(url);
        break;
      }
    }
  }

  private discardDedupKey(side: number | null, actorSeat: number | null, tileId: number | null): string {
    if (tileId !== null && Number.isFinite(tileId)) {
      return `tile:${Math.trunc(tileId)}`;
    }
    return `seat:${side ?? "n"}:${actorSeat ?? "n"}`;
  }

  private shouldSkipDuplicateDiscard(side: number | null, actorSeat: number | null, tileId: number | null): boolean {
    const now = Date.now();
    const key = this.discardDedupKey(side, actorSeat, tileId);
    const last = this.lastDiscardPlayByKey.get(key);
    this.lastDiscardPlayByKey.set(key, now);
    if (last !== undefined && now - last < 120) {
      return true;
    }
    this.pruneDiscardDedupMap(this.lastDiscardPlayByKey, now, 2000);
    return false;
  }

  private shouldSkipDuplicateDiscardTileVoice(
    side: number | null,
    actorSeat: number | null,
    tileId: number | null,
    tileKey: number | null
  ): boolean {
    const now = Date.now();
    const key = tileId !== null && Number.isFinite(tileId)
      ? `tile:${Math.trunc(tileId)}`
      : `seat:${side ?? "n"}:${actorSeat ?? "n"}:${tileKey ?? "n"}`;
    const last = this.lastDiscardTileVoiceByKey.get(key);
    this.lastDiscardTileVoiceByKey.set(key, now);
    if (last !== undefined && now - last < 300) {
      return true;
    }
    this.pruneDiscardDedupMap(this.lastDiscardTileVoiceByKey, now, 3000);
    return false;
  }

  private pruneDiscardDedupMap(map: Map<string, number>, now: number, ttlMs: number): void {
    if (map.size <= 64) {
      return;
    }
    for (const [k, t] of map.entries()) {
      if (now - t > ttlMs) {
        map.delete(k);
      }
    }
    while (map.size > 128) {
      const first = map.keys().next();
      if (first.done) break;
      map.delete(first.value);
    }
  }
}
