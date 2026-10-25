// Converts a route param to a positive integer, or returns null if invalid
const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

module.exports = parseId;