import { UnrecoverableError } from 'bullmq';

/** A run ended by a worker restart whose result could not be saved: recorded as the restart, with no alert and no retry. */
export class RunInterruptedError extends UnrecoverableError {}
