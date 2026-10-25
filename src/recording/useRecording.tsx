import { useEffect, useRef, useState } from 'preact/hooks';
import { IconMic, IconMicOff, IconStop } from '../icons';
import { MAX_RECORD_SECONDS, Recorder, type Recording } from './recorder';

interface Options {
  /** Size (CSS px) of the area being recorded. */
  getSize: () => { W: number; H: number };
  /** Paint the area (0..W × 0..H) as seen, including strokes being drawn. */
  paint: (ctx: CanvasRenderingContext2D) => void;
  baseName: string;
}

/** Start/stop a recording of an on-screen area, with optional voice. */
export function useRecording(o: Options) {
  const recorderRef = useRef<Recorder | null>(null);
  const opts = useRef(o);
  opts.current = o;
  /** Whole seconds recorded so far, or null when not recording. */
  const [seconds, setSeconds] = useState<number | null>(null);
  const [voice, setVoice] = useState(true);
  const [hasMic, setHasMic] = useState(false);
  const [result, setResult] = useState<Recording | null>(null);

  async function start() {
    if (recorderRef.current) return;
    const rec = new Recorder({
      getSize: () => opts.current.getSize(),
      paint: (ctx) => opts.current.paint(ctx),
      voice,
      baseName: opts.current.baseName.replace(/[^\w-]+/g, '_').slice(0, 40) || 'video',
      onTick: (secs) => {
        const whole = Math.floor(secs);
        setSeconds((prev) => (prev === whole ? prev : whole));
      },
      onDone: (r) => {
        recorderRef.current = null;
        setSeconds(null);
        setResult(r);
      },
      onError: (msg) => alert(`Recording problem: ${msg}`),
    });
    recorderRef.current = rec;
    setSeconds(0);
    try {
      await rec.start();
      setHasMic(rec.hasMic);
      rec.setVoice(voice);
    } catch (err) {
      recorderRef.current = null;
      setSeconds(null);
      alert(`Couldn't start recording: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stop() {
    recorderRef.current?.stop();
  }

  function toggleVoice() {
    const next = !voice;
    setVoice(next);
    recorderRef.current?.setVoice(next);
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  }

  // Leaving the screen mid-recording throws the recording away.
  useEffect(() => () => recorderRef.current?.discard(), []);

  return { isRecording: seconds !== null, seconds: seconds ?? 0, voice, hasMic, result, start, stop, toggleVoice, clearResult };
}

export type RecordingControls = ReturnType<typeof useRecording>;

const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

/** REC pill + Voice + Stop, shown over the recorded area (not part of the recording). */
export function RecBar({ rec }: { rec: RecordingControls }) {
  const voiceOn = rec.voice && rec.hasMic;
  return (
    <div class="rec-bar">
      <span class="rec-pill">
        <span class="rec-dot" />
        REC {fmt(rec.seconds)} / {fmt(MAX_RECORD_SECONDS)}
      </span>
      <button
        class={`rec-voice ${voiceOn ? 'is-on' : ''}`}
        onClick={rec.toggleVoice}
        disabled={!rec.hasMic}
        aria-label={voiceOn ? 'Voice on (tap to mute)' : 'Voice off'}
      >
        {voiceOn ? <IconMic /> : <IconMicOff />}
        <span>{!rec.hasMic ? 'No mic' : rec.voice ? 'Voice on' : 'Voice off'}</span>
      </button>
      <button class="rec-stop" onClick={rec.stop} aria-label="Stop recording">
        <IconStop />
        <span>Stop</span>
      </button>
    </div>
  );
}
