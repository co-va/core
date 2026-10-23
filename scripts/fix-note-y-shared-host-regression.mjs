import fs from 'node:fs';

const path = 'tests/note-y-runtime-browser.html';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: ${label}: expected one match, found ${count}`);
  source = source.replace(from, to);
}

replaceOnce(
`  <div class="v2-app" data-v2-app>
    <div class="v2-app__stage">`,
`  <div class="v2-app" data-v2-app>
    <div class="v2-y-host" data-v2-y-host hidden></div>
    <div class="v2-app__stage">`,
  'Shared Y host fixture',
);

replaceOnce(
`      const dayHost = document.querySelector('#day-host');
      const disposeDayOff = renderJournalDay(dayHost, {`,
`      const dayHost = document.querySelector('#day-host');
      const sharedYHost = document.querySelector('[data-v2-y-host]');
      const disposeDayOff = renderJournalDay(dayHost, {`,
  'Shared Y host handle',
);

replaceOnce(
`      assert(dayHost.querySelector('[data-note-reel="day-off-note"]'), 'Y did not render Note on a day without working time');`,
`      assert(sharedYHost.querySelector('[data-note-reel="day-off-note"]'), 'Shared Y did not render Note on a day without working time');`,
  'day-off Y assertion',
);

replaceOnce(
`      assert(dayHost.querySelector('[data-note-reel="time-note-browser"]')?.classList.contains('is-time-active'),
        'Y did not highlight Note from selected Journal time context');`,
`      assert(sharedYHost.querySelector('[data-note-reel="time-note-browser"]')?.classList.contains('is-time-active'),
        'Shared Y did not highlight Note from selected Journal time context');`,
  'time-context Y assertion',
);

replaceOnce(
`        const firstBefore = liveHost.querySelector('[data-note-reel]');`,
`        const firstBefore = sharedYHost.querySelector('[data-note-reel]');`,
  'live Y initial host',
);

replaceOnce(
`        const firstAfter = liveHost.querySelector('[data-note-reel]');`,
`        const firstAfter = sharedYHost.querySelector('[data-note-reel]');`,
  'live Y refreshed host',
);

replaceOnce(
`        assert(!liveHost.querySelector('[data-note-reel="live-old"]')?.classList.contains('is-time-active'),`,
`        assert(!sharedYHost.querySelector('[data-note-reel="live-old"]')?.classList.contains('is-time-active'),`,
  'live Y expired host',
);

fs.writeFileSync(path, source);
console.log('Note/Y browser fixture aligned with Shared Y host');
