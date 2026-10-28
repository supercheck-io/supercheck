import * as React from 'react';

const DOCS_URL = 'https://supercheck.io/docs/recorder#record-a-test';

// Mirrors the toolbar's real order; icons are the same codicons it renders.
const HELP_GROUPS: Array<{ title: string; items: Array<[icon: string, name: string, text: string]> }> = [
  {
    title: 'Record',
    items: [
      ['circle-large-filled', 'Record', 'Turn clicks and typing into Playwright code.'],
      ['save', 'Save', 'Send the code to the Supercheck Playground you opened the recorder from.'],
    ],
  },
  {
    title: 'Inspect',
    items: [
      ['inspect', 'Pick locator', 'Click an element to see its selector.'],
      ['eye', 'Assert', 'Check an element is visible, or check its text, value or snapshot.'],
    ],
  },
  {
    title: 'Code',
    items: [
      ['files', 'Copy', 'Copy the code to the clipboard.'],
      ['debug-pause', 'Pause / Resume / Step over', 'Control a replay while it runs.'],
      ['clear-all', 'Clear', 'Remove the recorded steps.'],
    ],
  },
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
          <strong className='supercheck-help-title'>How recording works</strong>
          {HELP_GROUPS.map(group => (
            <section key={group.title} className='supercheck-help-group'>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map(([icon, name, text]) => (
                  <li key={name}>
                    <span className={`codicon codicon-${icon}`} aria-hidden='true' />
                    <span><b>{name}</b> {text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className='supercheck-help-links'>
            <button type='button' onClick={() => chrome.runtime.openOptionsPage()}>Settings</button>
            <a href={DOCS_URL} target='_blank' rel='noopener noreferrer'>Documentation</a>
          </div>
        </div>
      )}
    </div>
  );
};
