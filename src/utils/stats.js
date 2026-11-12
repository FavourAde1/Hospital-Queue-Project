// Average consultation length in whole minutes from rows shaped { calledAt, completedAt }.
// Falls back to `fallbackMinutes` when there is nothing usable yet.
function averageConsultMinutes(rows, fallbackMinutes) {
  const minutes = rows
    .filter((r) => r.calledAt && r.completedAt)
    .map((r) => (new Date(r.completedAt) - new Date(r.calledAt)) / 60000)
    .filter((m) => m >= 0);
  if (minutes.length === 0) return fallbackMinutes;
  const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  return Math.max(1, Math.round(mean));
}

module.exports = { averageConsultMinutes };
