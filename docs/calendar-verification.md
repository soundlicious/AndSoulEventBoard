# Calendar interstitial verification

Verified locally on 2026-09-12. No WhatsApp messages, bookings, or attendance writes were made.

## Automated checks

`npm test` passes all 67 tests: 26 API, 19 bot, 19 display, and 3 shared tests. The new display tests cover the Momence query contract, pagination beyond 250 results and the four-page limit, upstream failures, UK midnight/DST handling, remaining-day filtering, attendance values, grid allocation, alternating rotation, and event-list changes. `git diff --check` passes.

## Browser and live integration checks

Used agent-browser with the actual display server and its browser modules. The live `/api/sessions` proxy returned Momence data successfully, and the browser displayed all 18 sessions remaining that morning, with loaded images and the expected time/title/attendance values. The screen was inspected at 1920×1080, 1280×720, and 1080×1920. No primary-field overflow or JavaScript errors were detected.

Network fixtures exercised denser layouts without changing production code. On the final implementation, six sessions occupied a full three-column/two-row grid at 1080p with secondary details visible; 40 sessions at 720p and 80 at 1080p retained every card, image area, time, title, and attendance value without scrolling or primary-field overflow. Earlier checks also covered one session and 24-session landscape/portrait layouts. Dense layouts necessarily use smaller text.

For timed behavior, a second local server used 1.2-second event/calendar intervals and a two-second schedule refresh. Browser observation recorded:

```text
Event one → calendar → Event two → calendar → Event one → calendar → Event two → calendar
```

Additional browser checks passed:

- One event alternates with the calendar; an empty community event list holds on the calendar.
- After a successful schedule load, an aborted request retains the previous sessions and displays the stale-data notice.
- Restoring the connection replaces the stale schedule; an empty result displays the end-of-day state.
- An initial failed load displays the automatic retry state and recovers without reloading.
- Missing/broken session images and unknown attendance values display fallbacks.
- Advancing the browser clock past a session's start removes it without reloading. Advancing across London midnight switches to the next day's remaining sessions and date heading.
- Calendar cards contain no links, buttons, inputs, focus targets, or flip interactions.

Live data verification used the real read-only Momence endpoint. Rotation/error scenarios used browser network fixtures, and the midnight scenario used a controlled browser clock. These checks do not establish behavior on a physical TV or deployment infrastructure.

## Grid-only refinement — 2026-09-14

Removed the calendar header, date, session count, update/status banner, and branding outside the cards. The clock and debug overlay are hidden during the calendar and restored on community-event slides. Only a single loading/error/empty message remains when there are no cards to show. Cached sessions continue displaying and refreshing silently during connection failures.

Browser-verified 21 live sessions at 1920×1080 and 1280×720 with no primary-text overflow or scrolling. Confirmed the event-to-calendar transition hides the clock and the calendar contains only its grid. Card fitting now also reacts to late font and image loads, which can change text geometry after the initial render.

## Pre-merge checks and configurable cadence — 2026-09-14

Added `DISPLAY_EVERY_X_EVENTS` in response to Pablo's PR review comment. It defaults to `1`; positive integers count event slides across list wraparound. Invalid values fall back to `1`. It does not change calendar dwell time, refresh frequency, the empty-event fallback, or `/calendar`.

All 70 automated tests pass (26 API, 19 bot, 22 display, 3 shared), including configurable cadence, invalid configuration, empty-feed persistence and recovery. `git diff --check` passes.

Used a separate local display server with 1.2-second event/calendar intervals, a two-second schedule refresh, and cadence `3`. Browser network fixtures changed only responses in the test browser, not stored events or the hallway deployment:

- An empty community feed on `/` displayed 20 live Momence sessions continuously across ten one-second samples, repeated event refreshes and rotation ticks. The clock stayed hidden and no empty community slide appeared.
- A failed community-event request on initial load still displayed the live Momence grid; the internal API-offline indicator was set, independently of calendar retrieval.
- Failed Momence requests after a successful load retained the grid. A fresh load during the failure showed `Schedule unavailable. Retrying…`.
- Empty Momence and community feeds showed only `No more sessions today.`. Restoring the live Momence route recovered the grid without reloading.
- Adding two fixture community events to an initially empty feed resumed rotation without reloading: `calendar → A → B → A → calendar → B → A → B → calendar`.
- `/calendar` stayed calendar-only with cadence `3` and made no community-event request. No uncaught JavaScript errors were reported.

These checks model the expected behavior after the new code is installed on the hallway computer, whose currently installed version has no Momence integration. They do not verify the physical display's connectivity or deploy any code there.
