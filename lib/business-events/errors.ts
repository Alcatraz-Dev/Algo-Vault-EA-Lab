import type { BusinessEvent } from "./types";

export class BusinessEventError extends Error {
  constructor(message: string, public code = "BUSINESS_EVENT_ERROR") {
    super(message);
    this.name = "BusinessEventError";
  }
}

export class EventValidationError extends BusinessEventError {
  constructor(msg: string) {
    super(msg, "EVENT_VALIDATION_ERROR");
  }
}
