import { useEffect, useRef } from 'preact/hooks';
import { IconBack } from '../icons';
import { pushBack } from '../backStack';

interface Props {
  onClose: () => void;
}

const SECTIONS: Array<{ title: string; items: string[] }> = [
  {
    title: 'Open a video',
    items: [
      'Quickest: in Google Photos or Gallery, open the video, tap Share › Row Coach.',
      'Or tap Open video and pick it from Files › DCIM › Camera.',
      'If a video won’t open, turn off the camera’s “high efficiency” / HEVC setting, or film at 1080p.',
    ],
  },
  {
    title: 'Play and step',
    items: [
      'Play button: play / pause. Speeds 1×, ½×, ¼×, ⅛×.',
      '⏮ ⏭: one frame back / forward. Hold to keep stepping.',
      'Scrub strip (the ruler): drag slowly for single frames. Drag left = forward.',
      'Timeline: drag to jump anywhere in the video.',
      'Speaker button: video sound on/off. It starts off (engine noise); the app remembers your choice.',
    ],
  },
  {
    title: 'Zoom and move the picture',
    items: [
      'Pinch with two fingers to zoom (up to 5×). Double-tap to go back to 1×.',
      'Two fingers drag the picture, in any mode.',
      'In Pan mode, one finger drags the picture too.',
      '− / + buttons zoom in steps.',
    ],
  },
  {
    title: 'Draw and measure',
    items: [
      'Pick Line, Arrow, Draw (freehand) or Angle, then use one finger.',
      'Angle: tap 3 points, with the joint (e.g. knee) as the 2nd point.',
      'A magnifier shows under your finger while you place points.',
      'Drawings can\u2019t be moved once made, so you can start a new one right on an old point.',
      'Erase: tap a drawing (or drag across several) to remove it. Undo brings it back.',
      'Colour button: colour, thickness, this frame only / whole video, list of drawings, delete, Clear all.',
      'Undo reverses the last change.',
    ],
  },
  {
    title: 'Snapshots',
    items: [
      'Camera button: saves exactly what’s on screen, with zoom and drawings.',
      'Add a note: it becomes the WhatsApp caption (it’s also copied, in case WhatsApp drops it).',
      'Share opens the share sheet. Share all sends every snapshot from this session.',
      'Save puts the picture in Downloads (Gallery › Download).',
    ],
  },
  {
    title: 'Recording a breakdown',
    items: [
      'Red record button: records the video area exactly as you see it — zoom, stepping, speed changes and drawing as you do them. Buttons aren’t recorded.',
      'Talk while you record. Voice on/off mutes your commentary at any time.',
      'Recording stops by itself at 2:00. Then Share (WhatsApp) or Save.',
    ],
  },
  {
    title: 'Landscape',
    items: [
      '» hides the right panel for a bigger video; « brings it back.',
      'The arrow at the bottom of the left rail slides the drawing tools away; the pen tab brings them back.',
      'House button: back to the home screen.',
    ],
  },
];

export function HelpScreen({ onClose }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => pushBack(() => onCloseRef.current()), []);

  return (
    <div class="help-screen">
      <header class="snapshot-head">
        <button class="icon-button" onClick={() => history.back()} aria-label="Close">
          <IconBack />
        </button>
        <h2>How to use</h2>
      </header>
      <div class="help-body">
        {SECTIONS.map((sec) => (
          <section>
            <h3>{sec.title}</h3>
            <ul>
              {sec.items.map((it) => (
                <li>{it}</li>
              ))}
            </ul>
          </section>
        ))}
        <p class="muted small">Videos stay on your phone. Nothing is uploaded.</p>
      </div>
    </div>
  );
}
