// Format check only — no MX lookup or SMTP handshake, so this confirms an
// address is *well-formed*, not that it's deliverable or actually exists.
// Fast and dependency-free, which is the right tradeoff for validating CSVs
// of a few thousand rows, but don't read "valid" here as "will receive mail".
export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};
