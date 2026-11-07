/**
 * src/lib/queue.js
 * Offline completion queue.
 * Wraps IndexedDB enqueue/dequeue for the completion retry loop.
 * The background retry is started from app.js after auth succeeds.
 */

import { startCompletionSubmissionRetry } from './completion-submission.mjs'

// Compatibility export for the application bootstrap. Completion retries are
// event-driven (boot and connectivity return), never a polling loop.
export function startQueueRetry () {
  startCompletionSubmissionRetry()
}
