# @voyant-travel/max-sdk

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
