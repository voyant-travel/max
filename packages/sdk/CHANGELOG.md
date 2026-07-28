# @voyant-travel/max-sdk

## 0.4.0

### Minor Changes

- f620d30: Add semantic, cardinality-aware entity card schemas and helpers for booking,
  product, person, departure, finance, and contract summaries. Open actions now
  require accessible user-facing labels, and action URLs and prompts trim and
  reject whitespace-only values; see the semantic card migration guide.

## 0.3.0

### Minor Changes

- 9043746: Add the `restaurantList` card kind (restaurant search results: photo, rating,
  cuisine, price, open status, reserve link), mirroring the platform agent-cards
  contract.

## 0.2.2

### Patch Changes

- ec220fd: Add `address` and `phone` to the hotel card (full street address + contact),
  mirroring the platform agent-cards contract.

## 0.2.1

### Patch Changes

- 98bbfcf: Add `bookUrl` to the hotel card's room/rate option, mirroring the platform
  agent-cards contract (a deep link to book that room).

## 0.2.0

### Minor Changes

- 0154c86: Add the `hotelList` and `hotel` card kinds to `AgentCardSchema`, so tools can
  return hotel search results and single-hotel detail cards (image gallery, stars,
  review score, amenities, and rooms/rates). Mirrors the platform agent-cards
  contract.
