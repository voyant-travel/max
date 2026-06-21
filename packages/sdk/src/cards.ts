import { z } from "zod"

/**
 * `@repo/agent-cards` — the shared contract for the structured "cards" the Max
 * agent embed renders as rich widgets.
 *
 * A card is an additive, display-ready payload attached to a tool result under
 * the `card` key. The backend (`@repo/agent-core`'s `buildCardForTool`) maps raw
 * upstream JSON into a card; the agent-app frontend renders it via a widget
 * registry. Everything here is pure zod + TS — no env, no upstream coupling — so
 * both sides import the same source of truth.
 *
 * Two tiers:
 *   - Bespoke kinds (`booking`, `customer`, `itinerary`, …) for the common
 *     operations, hand-tuned in the UI.
 *   - A `dynamic` kind = a list of LLM-safe presentation `Block`s, emitted by the
 *     `present_view` tool, for the long tail of ad-hoc views.
 *
 * Cards carry display-ready strings (the backend pre-formats money/dates with the
 * operator's locale) plus ids for actions — the frontend stays presentational.
 */

/** Semantic colour for badges/statuses. The UI maps these to design tokens. */
export const ToneSchema = z.enum(["default", "success", "warning", "danger", "info", "brand"])
export type Tone = z.infer<typeof ToneSchema>

export const BadgeSchema = z.object({
  label: z.string().min(1).max(80),
  tone: ToneSchema.optional(),
})
export type Badge = z.infer<typeof BadgeSchema>

/**
 * What an actionable element does when clicked.
 *  - `open`   → open a URL in a new tab (deep links into admin / storefront).
 *  - `prompt` → send a natural-language message to Max, so the model performs
 *               the next tool call and the existing approval card confirms any
 *               write. This powers "Publish", "Send offer", "Rebook", etc.
 *               without any new endpoints.
 */
export const CardActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open"),
    label: z.string().min(1).max(60).optional(),
    url: z.string().min(1).max(2000),
  }),
  z.object({
    kind: z.literal("prompt"),
    label: z.string().min(1).max(60),
    prompt: z.string().min(1).max(2000),
    tone: ToneSchema.optional(),
  }),
])
export type CardAction = z.infer<typeof CardActionSchema>

const KeyValueSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(600),
})

const TimelineItemSchema = z.object({
  title: z.string().min(1).max(240),
  date: z.string().max(80).optional(),
  amount: z.string().max(80).optional(),
  status: BadgeSchema.optional(),
  description: z.string().max(600).optional(),
  action: CardActionSchema.optional(),
})

const StatTileSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(120),
  hint: z.string().max(120).optional(),
})

// ---------------------------------------------------------------------------
// Bespoke card kinds
// ---------------------------------------------------------------------------

const CustomerCard = z.object({
  kind: z.literal("customer"),
  name: z.string().min(1).max(200),
  email: z.string().max(320).optional(),
  phone: z.string().max(80).optional(),
  avatarUrl: z.string().max(2000).optional(),
  jobTitle: z.string().max(160).optional(),
  status: BadgeSchema.optional(),
  segment: z.string().max(80).optional(),
  lifetimeValue: z.string().max(80).optional(),
  stats: z.array(StatTileSchema).max(6).optional(),
  timeline: z.array(TimelineItemSchema).max(20).optional(),
  note: z.string().max(600).optional(),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const BookingCard = z.object({
  kind: z.literal("booking"),
  title: z.string().min(1).max(240),
  reference: z.string().max(120).optional(),
  customer: z.string().max(200).optional(),
  status: BadgeSchema.optional(),
  dateRange: z.string().max(120).optional(),
  travelers: z.string().max(80).optional(),
  total: z.string().max(80).optional(),
  rows: z.array(KeyValueSchema).max(12).optional(),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const BookingListItem = z.object({
  title: z.string().min(1).max(240),
  subtitle: z.string().max(240).optional(),
  date: z.string().max(80).optional(),
  amount: z.string().max(80).optional(),
  status: BadgeSchema.optional(),
  action: CardActionSchema.optional(),
})

const BookingListCard = z.object({
  kind: z.literal("bookingList"),
  title: z.string().max(160).optional(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(BookingListItem).max(50),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const PeopleListItem = z.object({
  name: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(80).optional(),
  action: CardActionSchema.optional(),
})

const PeopleListCard = z.object({
  kind: z.literal("peopleList"),
  title: z.string().max(160).optional(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(PeopleListItem).max(50),
})

const ProductCard = z.object({
  kind: z.literal("product"),
  title: z.string().min(1).max(240),
  imageUrl: z.string().max(2000).optional(),
  priceDisplay: z.string().max(80).optional(),
  location: z.string().max(160).optional(),
  summary: z.string().max(800).optional(),
  badges: z.array(BadgeSchema).max(6).optional(),
  rows: z.array(KeyValueSchema).max(10).optional(),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const ProductListItem = z.object({
  title: z.string().min(1).max(240),
  imageUrl: z.string().max(2000).optional(),
  priceDisplay: z.string().max(80).optional(),
  subtitle: z.string().max(200).optional(),
  action: CardActionSchema.optional(),
})

const ProductListCard = z.object({
  kind: z.literal("productList"),
  title: z.string().max(160).optional(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(ProductListItem).max(50),
})

// Hotels — search results (`hotelList`) + a single hotel detail (`hotel`).
const HotelListItem = z.object({
  name: z.string().min(1).max(240),
  imageUrl: z.string().max(2000).optional(),
  /** Hotel class, 0–5. */
  stars: z.number().min(0).max(5).optional(),
  /** Guest review score, 0–5. */
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().int().nonnegative().optional(),
  priceDisplay: z.string().max(80).optional(),
  location: z.string().max(200).optional(),
})

const HotelListCard = z.object({
  kind: z.literal("hotelList"),
  title: z.string().max(160).optional(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(HotelListItem).max(50),
})

const HotelRoom = z.object({
  /** Room or rate name (e.g. "Standard King Room"). */
  type: z.string().min(1).max(160),
  provider: z.string().max(80).optional(),
  priceDisplay: z.string().max(80).optional(),
  capacity: z.string().max(80).optional(),
  /** Deep link to book this room/rate (opens in a new tab). */
  bookUrl: z.string().max(2000).optional(),
})

const HotelCard = z.object({
  kind: z.literal("hotel"),
  name: z.string().min(1).max(240),
  /** Hotel class, 0–5 (a "4-star hotel" — distinct from the review rating). */
  stars: z.number().min(0).max(5).optional(),
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().int().nonnegative().optional(),
  /** Neighborhood / short locality. */
  location: z.string().max(200).optional(),
  /** Full street address. */
  address: z.string().max(300).optional(),
  phone: z.string().max(60).optional(),
  priceDisplay: z.string().max(80).optional(),
  /** Gallery for the image carousel. */
  images: z.array(z.string().min(1).max(2000)).max(24).optional(),
  description: z.string().max(1200).optional(),
  amenities: z.array(z.string().min(1).max(80)).max(16).optional(),
  rooms: z.array(HotelRoom).max(12).optional(),
  actions: z.array(CardActionSchema).max(4).optional(),
})

// Restaurants — Google Maps search results.
const RestaurantListItem = z.object({
  name: z.string().min(1).max(240),
  imageUrl: z.string().max(2000).optional(),
  /** Guest review score, 0–5. */
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().int().nonnegative().optional(),
  /** Price tier, 1–4 ("$"–"$$$$"). */
  priceLevel: z.number().int().min(1).max(4).optional(),
  cuisine: z.string().max(80).optional(),
  address: z.string().max(200).optional(),
  openNow: z.boolean().optional(),
  /** Reserve-a-table deep link (opens in a new tab). */
  bookUrl: z.string().max(2000).optional(),
})

const RestaurantListCard = z.object({
  kind: z.literal("restaurantList"),
  title: z.string().max(160).optional(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(RestaurantListItem).max(50),
})

const ItineraryDay = z.object({
  number: z.number().int().min(0).max(366).optional(),
  title: z.string().min(1).max(240),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(2000).optional(),
})

const ItineraryCard = z.object({
  kind: z.literal("itinerary"),
  title: z.string().min(1).max(240),
  dateRange: z.string().max(120).optional(),
  heroImageUrl: z.string().max(2000).optional(),
  status: BadgeSchema.optional(),
  summary: z.string().max(2000).optional(),
  facts: z.array(KeyValueSchema).max(12).optional(),
  days: z.array(ItineraryDay).max(60),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const OfferCard = z.object({
  kind: z.literal("offer"),
  title: z.string().min(1).max(240),
  imageUrl: z.string().max(2000).optional(),
  priceDisplay: z.string().max(80).optional(),
  summary: z.string().max(800).optional(),
  link: z
    .object({
      label: z.string().min(1).max(160),
      url: z.string().min(1).max(2000),
    })
    .optional(),
  booked: z
    .object({
      label: z.string().min(1).max(200),
      total: z.string().max(80).optional(),
    })
    .optional(),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const DepartureListItem = z.object({
  date: z.string().min(1).max(120),
  priceDisplay: z.string().max(80).optional(),
  seats: z.string().max(80).optional(),
  status: BadgeSchema.optional(),
  action: CardActionSchema.optional(),
})

const DepartureListCard = z.object({
  kind: z.literal("departureList"),
  productTitle: z.string().max(240).optional(),
  items: z.array(DepartureListItem).max(60),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const InvoiceCard = z.object({
  kind: z.literal("invoice"),
  number: z.string().min(1).max(120),
  docType: z.string().max(60).optional(),
  status: BadgeSchema.optional(),
  total: z.string().max(80).optional(),
  customer: z.string().max(200).optional(),
  issuedDate: z.string().max(80).optional(),
  dueDate: z.string().max(80).optional(),
  rows: z.array(KeyValueSchema).max(12).optional(),
  actions: z.array(CardActionSchema).max(4).optional(),
})

const InvoiceListItem = z.object({
  number: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  amount: z.string().max(80).optional(),
  status: BadgeSchema.optional(),
  date: z.string().max(80).optional(),
  action: CardActionSchema.optional(),
})

const InvoiceListCard = z.object({
  kind: z.literal("invoiceList"),
  title: z.string().max(160).optional(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(InvoiceListItem).max(50),
})

const ImageGridImage = z.object({
  url: z.string().min(1).max(2000),
  thumbUrl: z.string().max(2000).optional(),
  alt: z.string().max(400).optional(),
  credit: z.string().max(240).optional(),
  link: z.string().max(2000).optional(),
})

const ImageGridCard = z.object({
  kind: z.literal("imageGrid"),
  title: z.string().max(160).optional(),
  images: z.array(ImageGridImage).min(1).max(24),
  note: z.string().max(400).optional(),
})

// ---------------------------------------------------------------------------
// Geo + weather + maps
// ---------------------------------------------------------------------------

const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

/** Coarse condition buckets the weather widget maps to lucide icons (no fetch). */
export const WeatherIconSchema = z.enum([
  "clear",
  "partly-cloudy",
  "cloudy",
  "rain",
  "drizzle",
  "thunderstorm",
  "snow",
  "mist",
  "wind",
])
export type WeatherIconName = z.infer<typeof WeatherIconSchema>

const WeatherHour = z.object({
  time: z.string().min(1).max(40),
  tempDisplay: z.string().min(1).max(20),
  icon: WeatherIconSchema.optional(),
  popDisplay: z.string().max(20).optional(),
})

const WeatherDay = z.object({
  day: z.string().min(1).max(40),
  hiDisplay: z.string().min(1).max(20),
  loDisplay: z.string().max(20).optional(),
  icon: WeatherIconSchema.optional(),
  popDisplay: z.string().max(20).optional(),
})

const WeatherCard = z.object({
  kind: z.literal("weather"),
  location: z.string().min(1).max(160),
  current: z.object({
    tempDisplay: z.string().min(1).max(20),
    feelsLikeDisplay: z.string().max(20).optional(),
    description: z.string().max(120).optional(),
    icon: WeatherIconSchema.optional(),
    humidityDisplay: z.string().max(20).optional(),
    windDisplay: z.string().max(40).optional(),
  }),
  hourly: z.array(WeatherHour).max(24).optional(),
  daily: z.array(WeatherDay).max(8).optional(),
  alerts: z
    .array(
      z.object({
        event: z.string().min(1).max(160),
        detail: z.string().max(400).optional(),
      }),
    )
    .max(4)
    .optional(),
  localTime: z.string().max(60).optional(),
})

const AirQualityCard = z.object({
  kind: z.literal("airQuality"),
  location: z.string().min(1).max(160),
  aqi: z
    .object({
      label: z.string().min(1).max(80),
      value: z.string().max(20).optional(),
      color: z.string().max(9).optional(),
      dominant: z.string().max(40).optional(),
    })
    .optional(),
  pollen: z
    .array(
      z.object({
        type: z.string().min(1).max(60),
        level: z.string().max(40).optional(),
      }),
    )
    .max(6)
    .optional(),
  coord: LatLngSchema.optional(),
})

const AddressCheckCard = z.object({
  kind: z.literal("addressCheck"),
  formattedAddress: z.string().max(400).optional(),
  status: BadgeSchema,
  unconfirmed: z.array(z.string().min(1).max(120)).max(12).optional(),
})

const MapMarker = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(40).optional(),
  title: z.string().max(160).optional(),
})

const ItineraryStop = z.object({
  time: z.string().max(40).optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(800).optional(),
  location: z.string().max(160).optional(),
  link: z
    .object({
      label: z.string().min(1).max(120),
      url: z.string().min(1).max(2000),
    })
    .optional(),
  /** Map-marker number for this stop, when it has a resolved location. */
  marker: z.number().int().min(1).max(30).optional(),
})

/** A composed day / multi-stop itinerary plan with a map (`itinerary_plan`). */
const ItineraryPlanCard = z.object({
  kind: z.literal("itineraryPlan"),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(600).optional(),
  stops: z.array(ItineraryStop).min(1).max(20),
  map: z
    .object({
      center: LatLngSchema,
      markers: z.array(MapMarker).max(20),
    })
    .optional(),
})

const MapCard = z.object({
  kind: z.literal("map"),
  center: LatLngSchema,
  zoom: z.number().int().min(1).max(20).optional(),
  markers: z.array(MapMarker).max(25).optional(),
  label: z.string().max(160).optional(),
})

// ---------------------------------------------------------------------------
// Dynamic blocks — the long-tail composer (`present_view`)
// ---------------------------------------------------------------------------

// Limits are deliberately tight: a `present_view` result is echoed straight to
// the model on the next step (it bypasses the upstream tool-result size cap
// because the card must reach the UI intact), so bounding the worst case here
// keeps the next request from blowing context / body limits.
export const BlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: z.string().min(1).max(160),
    level: z.number().int().min(1).max(3).optional(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().min(1).max(1000),
    muted: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("statTiles"),
    tiles: z.array(StatTileSchema).min(1).max(6),
  }),
  z.object({
    type: z.literal("keyValues"),
    items: z.array(KeyValueSchema).min(1).max(16),
  }),
  z.object({
    type: z.literal("badges"),
    items: z.array(BadgeSchema).min(1).max(10),
  }),
  z.object({
    type: z.literal("image"),
    url: z.string().min(1).max(2000),
    alt: z.string().max(240).optional(),
    caption: z.string().max(240).optional(),
  }),
  z.object({
    type: z.literal("timeline"),
    items: z.array(TimelineItemSchema).min(1).max(16),
  }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string().max(80)).min(1).max(6),
    rows: z.array(z.array(z.string().max(160)).max(6)).max(24),
  }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean().optional(),
    items: z.array(z.string().min(1).max(300)).min(1).max(30),
  }),
  z.object({ type: z.literal("divider") }),
  z.object({
    type: z.literal("button"),
    action: CardActionSchema,
  }),
])
export type Block = z.infer<typeof BlockSchema>

export const DynamicCardSchema = z.object({
  kind: z.literal("dynamic"),
  title: z.string().max(200).optional(),
  blocks: z.array(BlockSchema).min(1).max(24),
})
export type DynamicCard = z.infer<typeof DynamicCardSchema>

/** Input schema for the `present_view` tool (the dynamic card without `kind`). */
export const PresentViewInputSchema = z.object({
  title: z.string().max(200).optional(),
  blocks: z.array(BlockSchema).min(1).max(24),
})
export type PresentViewInput = z.infer<typeof PresentViewInputSchema>

// ---------------------------------------------------------------------------
// Union + helpers
// ---------------------------------------------------------------------------

export const AgentCardSchema = z.discriminatedUnion("kind", [
  CustomerCard,
  BookingCard,
  BookingListCard,
  PeopleListCard,
  ProductCard,
  ProductListCard,
  HotelListCard,
  HotelCard,
  RestaurantListCard,
  ItineraryCard,
  OfferCard,
  DepartureListCard,
  InvoiceCard,
  InvoiceListCard,
  ImageGridCard,
  WeatherCard,
  AirQualityCard,
  MapCard,
  ItineraryPlanCard,
  AddressCheckCard,
  DynamicCardSchema,
])
export type AgentCard = z.infer<typeof AgentCardSchema>
export type AgentCardKind = AgentCard["kind"]

/** Validate a standalone card object. Returns null when it doesn't match. */
export function parseCard(value: unknown): AgentCard | null {
  const result = AgentCardSchema.safeParse(value)
  return result.success ? result.data : null
}

/**
 * Pull a card off a tool output (`{ ...result, card }`) and validate it.
 * The frontend calls this on `part.output`; returns null for outputs with no
 * (or a malformed) card so the caller falls back to the plain status row.
 */
export function extractCard(toolOutput: unknown): AgentCard | null {
  if (!toolOutput || typeof toolOutput !== "object") return null
  const card = (toolOutput as { card?: unknown }).card
  if (card === undefined) return null
  return parseCard(card)
}
