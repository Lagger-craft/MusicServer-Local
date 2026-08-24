# Track Metadata Specification

## Purpose
Provide lazy, per-track metadata (artist, title, album, duration, cover availability) extracted via mutagen with a filename fallback, served through a cached API endpoint. Feeds the queue and lyrics features.

## Requirements

### Requirement: Metadata Endpoint
The system SHALL expose `GET /api/metadata?path=<track-path>` that returns metadata for a single track.

#### Scenario: Happy path — tagged file
- GIVEN a valid track path with ID3/Vorbis/MP4 tags
- WHEN the client requests `/api/metadata?path=<path>`
- THEN the response SHALL include `artist`, `title`, `album`, and `duration`
- AND a `cover` boolean indicating cover-art availability

#### Scenario: Edge — missing tags
- GIVEN a track with no usable tags
- WHEN the client requests metadata
- THEN the system SHALL fall back to filename parsing (`Artist - Title`)
- AND still return HTTP 200 with best-effort fields

### Requirement: Filename Fallback
The system SHALL parse `Artist - Title` (and optional `Artist - Title - Album`) from the filename when tags are absent or empty.

#### Scenario: Edge — malformed filename
- GIVEN a filename with no separator
- WHEN fallback parsing runs
- THEN `title` SHALL equal the filename without extension and `artist` SHALL be null

### Requirement: Lazy Evaluation
The system MUST NOT read tags during `list_files`/scan time; metadata is fetched only on play or lyrics-open.

#### Scenario: Edge — listing performance
- GIVEN a request to list the library
- WHEN `list_files` executes
- THEN no mutagen read occurs per file

### Requirement: Server-Side Cache
The system SHALL cache metadata results per track path using `ThreadSafeCache` for the session.

#### Scenario: Happy path — cache hit
- GIVEN metadata for a path was already fetched
- WHEN the same path is requested again
- THEN the system SHALL return the cached result without re-reading the file

### Requirement: Unknown Path Handling
The system SHALL return an error status (4xx) when the path is unknown, missing, or not a media file.

#### Scenario: Edge — nonexistent path
- GIVEN a path that does not resolve to a readable media file
- WHEN metadata is requested
- THEN the response SHALL be 4xx with an error message

### Requirement: Field Contract
The system SHALL return a stable JSON shape: `{artist, title, album, duration, cover, path}`.

#### Scenario: Happy path — shape
- GIVEN a successful metadata response
- THEN the JSON SHALL contain exactly those keys (null allowed for missing)
