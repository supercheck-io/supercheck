/** Grid classes for the run page's status cards: seven with the Job ID card, six for a single-test run without a job. */
export function statusCardsGridClass(hasJob: boolean): string {
  return hasJob ? "grid grid-cols-1 md:grid-cols-7 gap-2 mt-2" : "grid grid-cols-1 md:grid-cols-6 gap-2 mt-2";
}
