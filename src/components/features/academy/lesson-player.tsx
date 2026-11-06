'use client';

/**
 * The lesson player. Asks the server for a playback token (which checks the
 * viewer may watch, and burns their watermark into the DRM stream), then:
 *   - VdoCipher in production: its iframe + Player API (events, position);
 *   - the mock locally: a stand-in with the same events.
 * Heartbeats every 30 s while playing, and on pause / end, save the resume
 * point and count watch time (measured server-side). A 409 means the account
 * opened a lesson on another device: playback stops until "Watch here".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MonitorSmartphone, Pause, Play } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { playerBus, type PlayerHandle } from './player-bus';

interface PlaybackSession {
  provider: 'vdocipher' | 'mock';
  otp: string;
  playbackInfo: string;
  streamId: string;
  watermark?: string;
  resumeAt: number;
  durationSec: number;
}


declare global {
  interface Window {
    VdoPlayer?: { getInstance(iframe: HTMLIFrameElement): { video: HTMLVideoElement } };
  }
}

const HEARTBEAT_MS = 30_000;

export function LessonPlayer({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const t = useTranslations('academy.player');
  const router = useRouter();
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'taken' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<PlayerHandle | null>(null);
  const playing = useRef(false);
  const completedSent = useRef(false);

  const start = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const s = await apiClient.post<PlaybackSession>('/academy/playback', { courseId, lessonId });
      setSession(s);
      setState('ready');
    } catch (err) {
      setError(err instanceof ApiClientError && ['RATE_LIMITED', 'LOCKED', 'NOT_READY'].includes(err.code) ? t(`errors.${err.code}`) : t('errors.generic'));
      setState('error');
    }
  }, [courseId, lessonId, t]);

  useEffect(() => { void start(); }, [start]);

  const beat = useCallback(async (isPlaying: boolean, ended = false) => {
    if (!session || !handle.current) return;
    try {
      const res = await apiClient.post<{ completed: boolean }>('/academy/heartbeat', {
        streamId: session.streamId, courseId, lessonId,
        positionSec: Math.max(0, handle.current.position()), playing: isPlaying, ended,
      });
      if (res.completed && !completedSent.current) {
        completedSent.current = true;
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        playing.current = false;
        setState('taken');
      }
    }
  }, [session, courseId, lessonId, router]);

  // While playing: a heartbeat every 30 s. Also one when the tab is closed.
  useEffect(() => {
    if (state !== 'ready') return;
    const id = setInterval(() => { if (playing.current) void beat(true); }, HEARTBEAT_MS);
    const onHide = () => { if (document.visibilityState === 'hidden' && playing.current) void beat(true); };
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onHide); };
  }, [state, beat]);

  // Stable handlers: the VdoCipher listeners are attached once per session.
  // Resetting the server clock on play means paused time is never counted.
  const onPlay = useCallback(() => { playing.current = true; void beat(false); }, [beat]);
  const onPause = useCallback(() => { if (playing.current) { playing.current = false; void beat(true); } }, [beat]);
  const onEnded = useCallback(() => { playing.current = false; void beat(true, true); }, [beat]);
  const events = { onPlay, onPause, onEnded };

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black">
      {state === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-white/80"><Loader2 className="size-8 animate-spin" aria-label={t('loading')} /></div>}
      {state === 'error' && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/85">{error}</div>}
      {state === 'taken' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center text-white">
          <MonitorSmartphone className="size-10" aria-hidden />
          <p className="max-w-sm text-sm">{t('taken')}</p>
          <Button onClick={() => void start()}>{t('watchHere')}</Button>
        </div>
      )}
      {session && state !== 'loading' && state !== 'error' && (
        session.provider === 'vdocipher'
          ? <VdoCipherFrame key={session.otp} session={session} handle={handle} {...events} />
          : <MockPlayer key={session.streamId} session={session} handle={handle} {...events} />
      )}
    </div>
  );
}

interface FrameProps {
  session: PlaybackSession;
  handle: React.MutableRefObject<PlayerHandle | null>;
  onPlay(): void;
  onPause(): void;
  onEnded(): void;
}

/** VdoCipher's DRM player. Events come from its Player API (player.vdocipher.com/v2/api.js). */
function VdoCipherFrame({ session, handle, onPlay, onPause, onEnded }: FrameProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const src = `https://player.vdocipher.com/v2/?otp=${encodeURIComponent(session.otp)}&playbackInfo=${encodeURIComponent(session.playbackInfo)}`;

  useEffect(() => {
    let cancelled = false;
    const attach = () => {
      if (cancelled || !iframe.current || !window.VdoPlayer) return;
      const player = window.VdoPlayer.getInstance(iframe.current);
      const video = player.video;
      handle.current = { position: () => video.currentTime || 0, seek: (sec) => { video.currentTime = sec; } };
      playerBus.set(handle.current);
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('ended', onEnded);
      video.addEventListener('loadedmetadata', () => { if (session.resumeAt > 0) video.currentTime = session.resumeAt; }, { once: true });
    };
    if (window.VdoPlayer) attach();
    else {
      const s = document.createElement('script');
      s.src = 'https://player.vdocipher.com/v2/api.js';
      s.async = true;
      s.onload = attach;
      document.body.appendChild(s);
    }
    return () => { cancelled = true; handle.current = null; playerBus.set(null); };
  }, [session, handle, onPlay, onPause, onEnded]);

  return (
    <iframe
      ref={iframe}
      src={src}
      title="Lesson video"
      className="absolute inset-0 size-full border-0"
      allow="encrypted-media; fullscreen; autoplay"
      allowFullScreen
    />
  );
}

/** Local stand-in for the DRM player: same events, a ticking clock and the watermark overlay. */
function MockPlayer({ session, handle, onPlay, onPause, onEnded }: FrameProps) {
  const t = useTranslations('academy.player');
  const [pos, setPos] = useState(session.resumeAt);
  const [isPlaying, setIsPlaying] = useState(false);
  const posRef = useRef(session.resumeAt);
  const duration = session.durationSec || 90;

  useEffect(() => {
    handle.current = {
      position: () => posRef.current,
      seek: (sec) => { posRef.current = Math.min(duration, Math.max(0, sec)); setPos(posRef.current); },
    };
    playerBus.set(handle.current);
    return () => { handle.current = null; playerBus.set(null); };
  }, [handle, duration]);
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      posRef.current = Math.min(duration, posRef.current + 1);
      setPos(posRef.current);
      if (posRef.current >= duration) { setIsPlaying(false); onEnded(); }
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration, onEnded]);

  const toggle = () => {
    if (isPlaying) { setIsPlaying(false); onPause(); } else { setIsPlaying(true); onPlay(); }
  };
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    // Video controls read left to right in every language (as in every video player).
    <div dir="ltr" className="absolute inset-0 flex flex-col justify-end bg-gradient-to-br from-[#18211C] to-black text-white">
      <span className="pointer-events-none absolute start-[12%] top-[20%] select-none font-mono text-xs text-white/25 sm:text-sm">{session.watermark}</span>
      <span className="pointer-events-none absolute end-[10%] top-[62%] -rotate-6 select-none font-mono text-xs text-white/25 sm:text-sm">{session.watermark}</span>
      <span className="absolute start-3 top-3 rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{t('mock')}</span>
      <div className="space-y-2 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
        <input type="range" min={0} max={duration} value={pos} aria-label={t('seek')} className="w-full accent-[hsl(var(--primary))]"
          onChange={(e) => { posRef.current = Number(e.target.value); setPos(posRef.current); }} />
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={toggle} aria-label={isPlaying ? t('pause') : t('play')} className="rounded-full bg-white/15 p-2 hover:bg-white/25">
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <span className="tabular-nums">{mmss(pos)} / {mmss(duration)}</span>
        </div>
      </div>
    </div>
  );
}
