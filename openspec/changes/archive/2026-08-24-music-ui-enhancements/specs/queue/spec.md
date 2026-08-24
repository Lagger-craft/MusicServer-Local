# Queue Specification (YT-Music Style)

## Purpose
Redesign the playback queue drawer to mimic YouTube Music: a prominent current-track card with large cover, a blurred cover backdrop, a session-only history, and thumbnails for upcoming tracks.

## Requirements

### Requirement: Current-Track Card
The queue drawer SHALL display the currently playing track as a prominent card with a large cover image.

#### Scenario: Happy path — card render
- GIVEN a track is playing
- WHEN the queue drawer opens
- THEN the current track SHALL appear as a large-cover card with title/artist

### Requirement: Blurred Backdrop
The drawer SHOULD render a blurred version of the current cover as the backdrop behind the card.

#### Scenario: Happy path — backdrop
- GIVEN a current track with a cover
- WHEN the drawer renders
- THEN a blur layer SHALL be visible behind the card

### Requirement: Session History
The system SHALL maintain a `playHistory` array, populated with the outgoing track immediately before each track switch.

#### Scenario: Happy path — history push
- GIVEN a track is playing and the user switches to another
- WHEN the switch occurs
- THEN the previous track SHALL be prepended to `playHistory`

#### Scenario: Edge — first track
- GIVEN no prior track has played
- WHEN the first switch happens
- THEN `playHistory` SHALL contain exactly one entry

### Requirement: History Isolation
`playHistory` SHALL be session-only and MUST NOT be persisted to `playlists.json` or other storage.

#### Scenario: Edge — reload
- GIVEN the page is reloaded
- WHEN the app initializes
- THEN `playHistory` SHALL start empty

### Requirement: Sectioned Queue
The drawer SHALL separate "Próximo" (up next, from `playQueue`) from "Historial" (from `playHistory`).

#### Scenario: Happy path — two sections
- GIVEN both upcoming and history exist
- WHEN the drawer renders
- THEN two labeled sections SHALL be present

### Requirement: Upcoming Thumbnails
The drawer SHOULD show a small thumbnail for each upcoming track in `playQueue`.

#### Scenario: Happy path — thumbnail
- GIVEN an upcoming track has a cover
- WHEN the up-next list renders
- THEN a thumbnail SHALL appear for that row
