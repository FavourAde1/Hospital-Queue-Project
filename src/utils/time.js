// Returns the calendar date (YYYY-MM-DD) of `date` in the given IANA time zone.
// Ticket numbers restart each local day, so "today" must follow the hospital's clock, not the server's.
function localDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

module.exports = { localDate };
