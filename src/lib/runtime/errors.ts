/** A provider failure that says whether the engine may retry it once. */
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}
