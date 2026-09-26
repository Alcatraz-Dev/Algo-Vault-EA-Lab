export class FinancialModelError extends Error {
  constructor(message: string, public code = "FINANCIAL_MODEL_ERROR") {
    super(message);
    this.name = "FinancialModelError";
  }
}
