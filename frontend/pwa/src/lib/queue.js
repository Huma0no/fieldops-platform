/**
 * src/lib/queue.js
 * Offline completion queue.
 * Wraps IndexedDB enqueue/dequeue for the completion retry loop.
 * The background retry is started from app.js after auth succeeds.
 */

import {
  startCompletionSubmissionRetry,
  stopCompletionSubmissionRetry,
} from './completion-submission.mjs'
import { startPendingStartRetry } from './pending-starts.mjs'
import { startPhotoUploadRetry } from './photo-upload.mjs'

// Compatibility export for the application bootstrap. Completion retries are
// event-driven (boot and connectivity return), never a polling loop.
export function startQueueRetry () {
  startPendingStartRetry()
  startPhotoUploadRetry()
  startCompletionSubmissionRetry()
}

export function stopQueueRetry () {
  stopCompletionSubmissionRetry()
}
