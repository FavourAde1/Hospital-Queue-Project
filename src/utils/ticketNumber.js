const TICKET_NUMBER_PATTERN = /^[A-Z]{1,3}-\d{3,}$/;

// ("A", 7) -> "A-007"
function formatTicketNumber(code, sequence) {
  return `${code}-${String(sequence).padStart(3, '0')}`;
}

// First unused single letter A-Z, or null when all 26 are taken.
function nextFreeCode(usedCodes) {
  const used = new Set(usedCodes);
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return null;
}

module.exports = { TICKET_NUMBER_PATTERN, formatTicketNumber, nextFreeCode };
