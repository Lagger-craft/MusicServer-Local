# Player Animations Specification

## Purpose
Refactor playback UI animations for performance and accessibility: remove expensive perpetual animations, use explicit transitions, and honor reduced-motion preferences.

## Requirements

### Requirement: No Universal Transitions
The system MUST NOT use `transition: all` on large containers or frequently repainted elements.

#### Scenario: Edge — audit
- GIVEN the stylesheet is inspected
- WHEN searching for `transition: all`
- THEN no match SHALL occur on containers larger than a control

### Requirement: Remove Perpetual Pulse
The system MUST remove the perpetual pulse-glow animation (box-shadow based, non-composited).

#### Scenario: Edge — no infinite box-shadow
- GIVEN the player bar / cover elements
- WHEN the stylesheet is inspected
- THEN no `animation` with infinite box-shadow glow SHALL be present

### Requirement: Explicit Transitions
The system SHOULD declare explicit transition properties (e.g., `opacity`, `transform`) and use `will-change` on animated properties.

#### Scenario: Happy path — explicit
- GIVEN an element animates a property
- THEN its `transition` SHALL name the specific property, not `all`

### Requirement: Reduced Motion
The system MUST honor `prefers-reduced-motion: reduce` by disabling non-essential motion.

#### Scenario: Happy path — reduced
- GIVEN the OS requests reduced motion
- WHEN the UI renders
- THEN animations/transitions SHALL be suppressed or minimized

### Requirement: Limit Backdrop Filters
The system SHOULD limit `backdrop-filter` usage to intentional surfaces (e.g., queue blur) and avoid overuse.

#### Scenario: Edge — count
- GIVEN the stylesheet
- WHEN counting `backdrop-filter` declarations
- THEN they SHALL be limited to intentional surfaces only
