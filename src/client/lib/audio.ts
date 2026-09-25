import { prefGet, prefSet } from './session';

/**
 * 오디오: manifest 에 파일이 있을 때만 재생, 없으면 무음으로 완전히 동작한다.
 * 학생 기기는 기본 BGM/SFX 꺼짐. 첫 사용자 제스처 뒤에만 활성화.
 */
interface AudioManifest { audio: { id: string; kind: string; loop?: boolean; status: string }[] }

class AudioManager {
  private manifest: AudioManifest | null = null;
  private unlocked = false;
  private bgmEl: HTMLAudioElement | null = null;
  private bgmId: string | null = null;
  private lastPlay: Record<string, number> = {};
  bgmOn = prefGet('bgm', '0') === '1';
  sfxOn = prefGet('sfx', '0') === '1';
  bgmVolume = Number(prefGet('bgmVol', '0.4'));
  sfxVolume = Number(prefGet('sfxVol', '0.6'));
  speakerMode = prefGet('speaker', '0') === '1';

  async init(): Promise<void> {
    try {
      const res = await fetch('/assets/manifest.json');
      this.manifest = (await res.json()) as AudioManifest;
    } catch { this.manifest = { audio: [] }; }
    const unlock = () => { this.unlocked = true; document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); if (this.bgmOn && this.bgmId) this.bgm(this.bgmId); };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  private available(id: string): boolean {
    const a = this.manifest?.audio.find((x) => x.id === id);
    return !!a && a.status === 'ok';
  }

  setBgm(on: boolean): void { this.bgmOn = on; prefSet('bgm', on ? '1' : '0'); if (!on) this.stopBgm(); else if (this.bgmId) this.bgm(this.bgmId); }
  setSfx(on: boolean): void { this.sfxOn = on; prefSet('sfx', on ? '1' : '0'); }
  setSpeaker(on: boolean): void { this.speakerMode = on; prefSet('speaker', on ? '1' : '0'); }
  setBgmVolume(v: number): void { this.bgmVolume = v; prefSet('bgmVol', String(v)); if (this.bgmEl) this.bgmEl.volume = v; }
  setSfxVolume(v: number): void { this.sfxVolume = v; prefSet('sfxVol', String(v)); }

  /** 배경음악 전환 (2~4초 crossfade 는 파일이 있을 때만 의미가 있으므로 단순 교체) */
  bgm(id: string): void {
    this.bgmId = id;
    if (!this.bgmOn || !this.unlocked || !this.available(id)) return;
    if (this.bgmEl && this.bgmEl.dataset['id'] === id) return;
    this.stopBgm();
    const el = new Audio(`/assets/audio/${id}.mp3`);
    el.loop = true; el.volume = this.bgmVolume; el.dataset['id'] = id;
    el.play().catch(() => {});
    this.bgmEl = el;
  }
  stopBgm(): void { if (this.bgmEl) { try { this.bgmEl.pause(); } catch {} this.bgmEl = null; } }

  /** 효과음: 자신의 조작·차례 알림만. 초당 중복 재생 제한. */
  sfx(id: string): void {
    if (!this.sfxOn || !this.unlocked || !this.available(id)) return;
    const now = Date.now();
    if (now - (this.lastPlay[id] ?? 0) < 150) return;
    this.lastPlay[id] = now;
    const el = new Audio(`/assets/audio/${id}.mp3`);
    el.volume = this.sfxVolume;
    el.play().catch(() => {});
  }
  sting(id: string): void { this.sfx(id); }
}

export const audio = new AudioManager();
