# Migrating to semantic entity cards

Semantic entity cards make identity, dates, actions, and result cardinality
explicit. Existing bespoke kinds such as `booking`, `bookingList`, `product`,
and `invoice` remain in `AgentCard`, so producers can migrate independently.

## Action labels

Every action now requires a user-facing `label`, including `open` actions.
Labels, open-action URLs, and prompt-action prompts are trimmed and reject
whitespace-only values. These are the only stricter legacy validations in this
release. Replace an unlabeled URL with a specific destination such as
`Open booking`, `Open customer`, or `Review contract`. Avoid generic labels such
as `Open` or `View` when several entities could be on screen.

Legacy badge and key/value schemas otherwise retain their existing whitespace
behavior. Trimming for status labels, fact labels, and fact values applies only
to the new semantic entity contracts.

## Identity and context

For one result, replace presentation-only `title` and `subtitle` fields with:

- `displayName`: the one human-readable identity displayed most prominently;
- `reference`: an optional stable reference, which must not duplicate the
  display name; and
- named context such as `customer`, `product`, `departure`, `travelers`,
  `location`, `contact`, `capacity`, `documentType`, or `contractType`.

Use `entityIdentity(displayName, reference)` when adapting upstream data, or
`defineEntityCard(card)` at the producer boundary. Both throw on duplicated
identity. `parseEntityCard(value)` returns `null` for untrusted invalid input.

## Dates

Replace bare `date`, `dateRange`, `issuedDate`, and `dueDate` values with
`dates: [{ label, value }]`. The producer formats `value` for the operator's
locale and configured timezone. The renderer displays it as-is and does not
parse it as an ISO timestamp. Include a timezone abbreviation or offset when a
time is shown.

## Cardinality

- Zero results: `entityCollection` with `state: "empty"` and no items.
- Exactly one result: `entity`; a one-item collection is rejected.
- Complete multiple results: `entityCollection` with `state: "many"`; `total`
  may be omitted.
- Truncated results: `entityCollection` with `state: "truncated"`, one or more
  included items, and a `total` greater than the number of included items.

Collection items must all match the collection's `entityType`. These rules let
hosts choose singular, plural, empty, and truncation chrome without guessing.
