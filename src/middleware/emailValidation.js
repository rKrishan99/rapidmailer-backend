// src/middleware/emailValidation.js
import { validateEmail } from "../utils/emailValidator.js";

export const validateEmails = (req, res, next) => {
  const { emails } = req.body;

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
