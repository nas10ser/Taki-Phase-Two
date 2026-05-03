let target = null;
function setBookings(updater) {
  // Simulating React state batching (it doesn't run updater immediately in all versions)
  // Actually, React 18+ runs updater during the render phase if it's batched.
  // Wait, no, React queues the updater!
}
