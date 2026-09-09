// src/middleware/emailValidation.js
import { validateEmail } from "../utils/emailValidator.js";

// The send endpoint supports two request shapes: the original blast mode
// ({ emails: [...] }) and the newer personalized mail-merge mode
// ({ mode: 'personalized', records: [{ email, ... }] }). This only validates
// email format for whichever shape is actually present — it does not
// require `emails` when the request is personalized, and vice versa.
export const validateEmails = (req, res, next) => {
  const { emails, mode, records } = req.body;

  if (mode === "personalized") {
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ error: "records array is required for personalized mode" });
    }

    const withEmail = records.filter((r) => r && r.email);
    const invalidEmails = withEmail.filter((r) => !validateEmail(r.email)).map((r) => r.email);

    if (invalidEmails.length > 0) {
      return res.status(400).json({
        error: "Some records have an invalid email",
        invalidEmails,
        validCount: withEmail.length - invalidEmails.length,
        invalidCount: invalidEmails.length,
      });
    }

    return next();
  }

  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: "Emails array is required" });
  }

  // Validate each email format
  const invalidEmails = emails.filter((email) => !validateEmail(email));

  if (invalidEmails.length > 0) {
    return res.status(400).json({
      error: "Some emails are invalid",
      invalidEmails,
      validCount: emails.length - invalidEmails.length,
      invalidCount: invalidEmails.length,
    });
  }

  next();
};
