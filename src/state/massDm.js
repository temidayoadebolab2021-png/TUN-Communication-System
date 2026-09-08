// Tiny shared piece of memory so the /cancel command and the /dm role command
// can talk to each other. This only lives in RAM while the bot is running -
// it resets if the bot restarts, which is fine since there's nothing to
// cancel right after a restart anyway.

let cancelMassDm = false;

function requestCancel() {
  cancelMassDm = true;
}

function resetCancel() {
  cancelMassDm = false;
}

function isCancelled() {
  return cancelMassDm;
}

module.exports = { requestCancel, resetCancel, isCancelled };
