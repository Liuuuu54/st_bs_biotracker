# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

### Gestation Speed Semantics

The gestation speed fields have distinct responsibilities and must not be treated as interchangeable values.

- `gestationSpeciesSpeed`
  - Represents the species-defined base gestation speed.
  - Must remain at or above `0.1`.
  - Must not use `0` as a normal configuration value.

- `gestationModifierMultiplier`
  - Represents the dynamic modifier applied to the species base gestation speed.
  - Valid range includes `0`.
  - `0` is a valid intentional state meaning that effective fetal development is temporarily frozen.
  - This is the supported control point for temporarily freezing gestational development.

- `gestationEffectiveSpeed`
  - Represents the final effective gestation speed.
  - Normally derived from `gestationSpeciesSpeed × gestationModifierMultiplier`.
  - `0` is a valid derived state and means effective fetal development is currently frozen.
  - It does not mean that real-world time stops or that the entire pregnancy state is suspended.

#### Freeze Semantics

When `gestationEffectiveSpeed === 0`:

- `effectivePregnantDays` must not advance due to elapsed time.
- `pregnantDays` retains its own real-time semantics and must not be frozen merely because effective gestation speed is zero.
- The pregnancy state itself remains active.
- Other pregnancy-related subsystems must not automatically treat `0` as an invalid value or globally freeze their own calculations unless their business semantics explicitly depend on effective fetal development.

#### Forbidden Patterns

- Do not clamp a valid `gestationEffectiveSpeed === 0` to `0.1` merely to avoid handling the frozen state.
- Do not treat `gestationSpeciesSpeed === 0` and `gestationModifierMultiplier === 0` as equivalent states.
- Do not interpret `gestationEffectiveSpeed === 0` as "pregnancy does not exist".
- Do not globally stop all pregnancy-related time or recovery calculations when effective gestation speed is zero.

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
