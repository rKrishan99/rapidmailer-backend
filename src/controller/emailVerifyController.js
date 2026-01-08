import axios from 'axios';
import validator from 'validator';
import dns from 'dns/promises';

const ABSTRACT_API_KEY = 'f1a2829f573546f393609edaa69d25e8';
const API_URL = 'https://emailvalidation.abstractapi.com/v1/';

// Cache to store validation results for 24 hours
const emailCache = new Map();

const validateWithAbstractAPI = async (email) => {
  try {
    const response = await axios.get(`${API_URL}?api_key=${ABSTRACT_API_KEY}&email=${email}`);
    return {
      valid: response.data.deliverability === 'DELIVERABLE',
      isDisposable: response.data.is_disposable_email.value,
      isRoleEmail: response.data.is_role_email.value,
      reason: response.data.deliverability === 'DELIVERABLE' 
        ? '' 
        : response.data.deliverability.toLowerCase()
    };
  } catch (error) {
    console.error('Abstract API Error:', error.message);
    return null; // API failed
  }
};

const basicValidation = async (email) => {
  // Format check
  if (!validator.isEmail(email)) {
    return { valid: false, reason: 'invalid format' };
  }

  // Domain check
  const domain = email.split('@')[1];
  try {
    await dns.resolveMx(domain);
    return { valid: true, reason: '' };
  } catch (error) {
    return { valid: false, reason: 'domain not found' };
  }
};

export const validateEmail = async (email) => {
  // 1. Basic format check
  if (!validator.isEmail(email)) {
    return { email, valid: false, reason: 'invalid format' };
  }

  const domain = email.split('@')[1];
  const freeEmailDomains = ['gmail.com', 'yahoo.com', 'outlook.com'];

  // 2. Skip API checks for major free providers
  if (freeEmailDomains.includes(domain)) {
    return { 
      email, 
      valid: true, 
      reason: 'assumed valid (free email provider)' 
    };
  }

  // 3. For other domains, use Abstract API
  try {
    const response = await axios.get('https://emailvalidation.abstractapi.com/v1/', {
      params: { api_key: 'YOUR_KEY', email }
    });

    // Custom rules for deliverability
    const isDeliverable = (
      response.data.deliverability === 'DELIVERABLE' ||
      (response.data.is_mx_found && response.data.is_valid_format)
    );

    return {
      email,
      valid: isDeliverable,
      reason: isDeliverable ? '' : response.data.deliverability
    };
  } catch (error) {
    // Fallback to MX check
    try {
      await dns.resolveMx(domain);
      return { email, valid: true, reason: 'domain valid (API failed)' };
    } catch {
      return { email, valid: false, reason: 'domain invalid' };
    }
  }
};