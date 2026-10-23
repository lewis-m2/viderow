import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenVideo } from '../App';
import { IconBack, IconCollapse, IconExpand, IconPause, IconPlay } from '../icons';
import { formatCount, formatFps, formatLength, formatTime } from '../format';
import { frameCount, frameIndexAt } from '../video/probe';
import { useMediaQuery } from '../useMediaQuery';

const SPEEDS = [
  { rate: 1, label: '1×' },
  { rate: 0.5, label: '½×' },
  { rate: 0.25, label: '¼×' },
  { rate: 0.125, label: '⅛×' },
];

const SCRUB_FADE_MS = 3000;

interface Props {
  video: OpenVideo;
  onBack: () => void;
}

export function Analyse({ video, onBack }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [collapsed, setCollapsed] = useState(false);
  const [scrubVisible, setScrubVisible] = useState(true);
  const fadeTimer = useRef<number | undefined>(undefined);
  const landscape = useMediaQuery('(orientation: landscape)');
  const { meta } = video;

  // Keep time in step with the frame actually on screen.
  useEffect(() => {
    const v = ref.current!;
    let handle = 0;
    const onFrame: VideoFrameRequestCallback = (_now, md) => {
      setTime(md.mediaTime);
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);

    const sync = () => {
      setPlaying(!v.paused && !v.ended);
      if (v.paused) setTime(v.currentTime);
    };
    const onMeta = () => setDuration(v.duration);
    const events = ['play', 'pause', 'ended', 'seeked'] as const;
    events.forEach((e) => v.addEventListener(e, sync));
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    return () => {
      v.cancelVideoFrameCallback(handle);
      events.forEach((e) => v.removeEventListener(e, sync));
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
    };
  }, []);

  useEffect(() => {
    ref.current!.playbackRate = rate;
  }, [rate, duration]);

  // Space bar toggles play (handy when developing on a computer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function togglePlay() {
    const v = ref.current!;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      v.play();
    } else {
      v.pause();
    }
  }

  function seek(t: number) {
    ref.current!.currentTime = t;
    setTime(t);
  }

  // Slim scrub bar over the video (landscape collapsed) fades when unused.
  function showScrub() {
    setScrubVisible(true);
    clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => setScrubVisible(false), SCRUB_FADE_MS);
  }
  useEffect(() => {
    if (landscape && collapsed) showScrub();
    return () => clearTimeout(fadeTimer.current);
  }, [landscape, collapsed]);

  const total = frameCount(meta, duration);
  const frame = Math.min(frameIndexAt(meta, time), total - 1) + 1;
  const frameLabel = `Frame ${formatCount(frame)} / ${formatCount(total)} · ${formatTime(time)}`;
  const fpsLabel = `${meta.fpsEstimated ? '~' : ''}${formatFps(meta.fps)} fps · ${formatLength(duration)}`;
  const showOverlay = landscape && collapsed;

  const playButton = (big: boolean) => (
    <button
      class={`play-button ${big ? 'is-big' : ''}`}
      onClick={togglePlay}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {playing ? <IconPause /> : <IconPlay />}
    </button>
  );

  return (
    <div
      class={`analyse ${landscape ? 'is-landscape' : 'is-portrait'} ${showOverlay ? 'is-collapsed' : ''}`}
    >
      <header class="topbar">
        <button class="icon-button" onClick={onBack} aria-label="Back">
          <IconBack />
        </button>
        <div class="topbar-title">
          <div class="video-name">{video.name}</div>
          <div class="muted small">{fpsLabel}</div>
        </div>
      </header>

      <div class="stage" onPointerDown={showOverlay ? showScrub : undefined}>
        <video
          ref={ref}
          src={video.url}
          playsInline
          preload="auto"
          disablePictureInPicture
        />
        {showOverlay && (
          <div class={`overlay-scrub ${scrubVisible ? '' : 'is-hidden'}`}>
            <div class="frame-label small">{frameLabel}</div>
            <Timeline time={time} duration={duration} onSeek={seek} onActivity={showScrub} />
          </div>
        )}
      </div>

      <section class="info">
        <div class="frame-label">{frameLabel}</div>
        <Timeline time={time} duration={duration} onSeek={seek} />
      </section>

      <section class="controls">
        {landscape && (
          <button
            class="icon-button collapse-button"
            onClick={() => setCollapsed(true)}
            aria-label="Hide panel"
          >
            <IconCollapse />
          </button>
        )}
        <div class="playback-row">{playButton(true)}</div>
        <div class="speeds" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              role="radio"
              aria-checked={rate === s.rate}
              class={`speed ${rate === s.rate ? 'is-selected' : ''}`}
              onClick={() => setRate(s.rate)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {showOverlay && (
        <section class="mini-controls">
          <button class="icon-button" onClick={() => setCollapsed(false)} aria-label="Show panel">
            <IconExpand />
          </button>
          {playButton(false)}
        </section>
      )}
    </div>
  );
}

interface TimelineProps {
  time: number;
  duration: number;
  onSeek: (t: number) => void;
  onActivity?: () => void;
}

function Timeline({ time, duration, onSeek, onActivity }: TimelineProps) {
  const pct = duration > 0 ? (time / duration) * 100 : 0;
  return (
    <input
      class="timeline"
      type="range"
      min={0}
      max={duration || 0}
      step="any"
      value={time}
      style={{ '--pct': `${pct}%` }}
      aria-label="Timeline"
      onInput={(e) => {
        onSeek(Number((e.currentTarget as HTMLInputElement).value));
        onActivity?.();
      }}
      onPointerDown={onActivity}
    />
  );
}
