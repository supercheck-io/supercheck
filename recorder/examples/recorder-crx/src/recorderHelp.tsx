import * as React from 'react';

const DOCS_URL = 'https://supercheck.io/docs/recorder';

const TOOLBAR_HELP: Array<[string, string]> = [
  ['Record', 'Start or stop capturing your clicks and typing as Playwright code.'],
  ['Save', 'Send the recorded test back to the Supercheck project you opened this from.'],
  ['Pick locator', 'Click an element on the page to get its selector.'],
  ['Assert', 'Add assertions for visibility, text or a value.'],
  ['Copy / Run / Pause', 'Copy the code, replay it, or pause the replay.'],
  ['Clear', 'Remove the recorded steps.'],
  ['Theme', 'Switch between light and dark.'],
];

/**
 * "i" button at the end of the recorder toolbar. The panel is positioned with
 * `fixed` from the button's rectangle so the toolbar's overflow never clips it.
 */
export const RecorderHelp: React.FC = () => {
  const [pinned, setPinned] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [position, setPosition] = React.useState({ top: 0, right: 0 });
  const rootRef = React.useRef<HTMLDivElement>(null);
  const open = pinned || hovered;

  const place = React.useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect)
      setPosition({ top: rect.bottom + 6, right: Math.max(window.innerWidth - rect.right, 8) });
  }, []);

  React.useEffect(() => {
    if (!open)
      return;
    place();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        setPinned(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node))
        setPinned(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return (
    <div
      ref={rootRef}
      className='supercheck-help'
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type='button'
        className='supercheck-help-button'
        aria-label='How recording works'
        aria-expanded={open}
        title='How recording works'
        onClick={() => setPinned(value => !value)}
      >
        <span className='codicon codicon-info' />
      </button>
      {open && (
        <div role='dialog' aria-label='How recording works' className='supercheck-help-card' style={position}>
          <strong>How recording works</strong>
          <dl>
            {TOOLBAR_HELP.map(([name, text]) => (
              <React.Fragment key={name}>
                <dt>{name}</dt>
                <dd>{text}</dd>
              </React.Fragment>
            ))}
          </dl>
          <div className='supercheck-help-links'>
            <a href='#' onClick={event => { event.preventDefault(); chrome.runtime.openOptionsPage(); }}>
              Connection and settings
            </a>
            <a href={DOCS_URL} target='_blank' rel='noopener noreferrer'>Docs</a>
          </div>
        </div>
      )}
    </div>
  );
};
