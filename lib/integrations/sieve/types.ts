// Sieve scrape API — wire types (documents the contract; no runtime behavior).

/** Relitigation of the site-access policy. "regular" is the default. */
export type SieveComplianceMode = "conservative" | "regular" | "yolo";

export type SieveTableShape = "long" | "wide";

export interface SieveFile {
  name: string;
  size: number;
  ext: string;
  /** Relative to the API base URL. Prefix it and send the Bearer header. */
  url: string;
}

export type SieveSchemaConformanceStatus =
  | "pass"
  | "partial"
  | "fail"
  | "not_checkable"
  | "no_artifact";

export interface SieveSchemaConformance {
  status: SieveSchemaConformanceStatus;
  [key: string]: unknown;
}

export interface SieveRefusal {
  code: string;
  message?: string;
  [key: string]: unknown;
}

export interface SieveRun {
  session_id: string;
  status: string;
  /** Advances when a follow-up turn is recorded. Read the payload only once
   *  this AND status:"done" are satisfied. */
  turns?: number;
  summary?: string;
  files?: SieveFile[];
  schema_conformance?: SieveSchemaConformance;
  /** Present inline when output_schema was supplied and the run conformed. */
  result?: unknown;
  refusal?: SieveRefusal;
  [key: string]: unknown;
}

/** 202 body returned by POST /api/scrapes. */
export interface SieveAcceptedRun {
  status: "queued";
  session_id: string;
  poll: string;
}

export interface SieveStartRunInput {
  /** Plain-language task. Required. */
  instruction: string;
  target_urls?: string[];
  fields?: string[];
  schema?: Record<string, unknown>;
  /** Strict JSON Schema 2020-12, <= 32KB. */
  output_schema?: Record<string, unknown>;
  table_shape?: SieveTableShape;
  compliance_mode?: SieveComplianceMode;
  /** Optional document for multipart/form-data ("file" field). */
  document?: {
    filename: string;
    content: Uint8Array;
    contentType?: string;
  };
}

/** Follow-up body: same fields as a start (instruction carries the new ask). */
export type SieveFollowUpInput = SieveStartRunInput;

export interface SieveCredits {
  plan?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  [key: string]: unknown;
}

// ── Device login ─────────────────────────────────────────────────────────────

export interface SieveDeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export type SieveDeviceTokenResult =
  | { status: "approved"; apiKey: string; tokenType: string; keyName: string }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" };
