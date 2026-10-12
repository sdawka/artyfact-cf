import type { Facts } from "../engine";

/** A mutation of a valid mini model that must make `rule` fire on `subject`. */
export interface InvalidCase {
  name: string;
  rule: string;
  subject: string;
  /** relation of the finding; defaults to anything */
  relation?: string;
  facts: Facts;
}

export interface PackFixture {
  pack: string;
  valid: Facts;
  invalid: InvalidCase[];
}
