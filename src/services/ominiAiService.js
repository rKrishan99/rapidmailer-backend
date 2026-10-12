// src/services/ominiAiService.js
import axios from "axios";
import { logger } from "../utils/loggerService.js";

const SYSTEM_INSTRUCTION = `You are Omini, the world-class AI companion and growth engineer embedded directly inside OmniPlus+ (commercial marketing & outreach automation platform).
Your mission is to guide users to achieve 10x ROI on lead generation, scraping, WhatsApp automation, and cold email outreach.

Your Core Expertise:
1. Google Maps & Web Scraping: Overcoming the 120-place result cap using sub-locality/postal code matrices, keyword structuring, deduplication, and Google Maps API/PageSpeed optimizations.
2. WhatsApp Automation & Anti-Ban Security: Anti-ban pacing (35-75s randomized delays), account warming peer-to-peer schedules, Spintax variation, active member filtering, and WhatsApp Business safety protocols.
3. Cold Email Copy & Deliverability: Writing irresistible 50-word cold emails, SPF/DKIM/DMARC compliance, bounce cleaning with SMTP verification, and subject line formulas that get 60%+ open rates.
4. Social Media & Data Enrichment: Finding email/phone/social profiles (Facebook, Instagram, LinkedIn, YouTube) for leads that have no active website.

Language & Tone:
- Always reply in the exact language the user addresses you in (e.g. if prompted in Sinhala සිංහල, reply in natural, fluent Sinhala; if in Spanish, reply in fluent Spanish; if in English, reply in crisp English).
- Be concise, practical, highly actionable, and formatted with clean Markdown, bullet points, and code/template blocks where helpful.`;

function getRouteContext(route) {
  if (!route) return "General OmniPlus+ Dashboard";
  if (route.includes("gmap-grid")) return "Maps Grid Matrix Scraper — User is overcoming the 120-lead limit via sub-regions/ZIP codes.";
  if (route.includes("gmap-data")) return "Google Maps Extractor — User is extracting business leads (phone, name, address, website).";
  if (route.includes("whatsapp-warmer")) return "WhatsApp Warmer Engine — User is warming accounts via peer-to-peer dialogues to establish meta trust.";
  if (route.includes("whatsapp-sender")) return "WhatsApp Bulk Sender — User is preparing bulk messages; prioritize anti-ban pacing & Spintax.";
  if (route.includes("whatsapp-active")) return "Grab Active Group Members — Filtering active participants vs ghost numbers.";
  if (route.includes("whatsapp-filter")) return "WhatsApp Number Filter — Validating which phone numbers are registered on WA.";
  if (route.includes("social-enricher")) return "Social Enricher — Finding social handles and emails for businesses lacking websites.";
  if (route.includes("verify-mails")) return "Email Verifier — Real-time MX and SMTP mailbox pinging to prevent domain blacklisting.";
  if (route.includes("send-mails")) return "Email Campaign Blast — Preparing cold outreach templates with personalization tags.";
  if (route.includes("website-audit")) return "Website Audit — Analyzing Core Web Vitals and performance bottlenecks.";
  if (route.includes("tech-detector")) return "Tech Stack Detector — Detecting CMS, frameworks, and analytics tags.";
  if (route.includes("settings")) return "Enterprise Settings — Configuring scraping headless mode, themes, HWID licenses, and logs.";
  return `Current section: ${route}`;
}

/**
 * Fallback contextual engine when external API keys are not provided
 */
function generateLocalResponse(userPrompt, route) {
  const p = userPrompt.toLowerCase();
  const isSinhala = /[\u0D80-\u0DFF]/.test(userPrompt);
  const isSpanish = /\b(hola|cómo|como|ayuda|correo|enviar|gracias)\b/i.test(userPrompt);

  if (isSinhala) {
    if (p.includes("whatsapp") || p.includes("වට්ස්ඇප්") || route.includes("whatsapp")) {
      return `### 🚀 Omini WhatsApp Anti-Ban මාර්ගෝපදේශය:

1. **Randomized Delay**: පණිවිඩ අතර තත්පර 35 - 75 ක අහඹු ප්‍රමාදයක් (random delay) තබා ගන්න.
2. **Account Warming**: නව ගිණුම් සඳහා දිනකට පණිවිඩ 20-30 කින් ආරම්භ කර ක්‍රමයෙන් වැඩි කරන්න.
3. **Spintax භාවිතය**: එකම පණිවිඩය නැවත නැවත නොයවා \`{Hi|Hello|Dear}\` වැනි Spintax භාවිතා කරන්න.
4. **Active Members පමණක් තෝරන්න**: Groups වලින් активු සාමාජිකයින් පමණක් Export කරගන්න.

තවත් WhatsApp හෝ Email campaign එකක් සඳහා උදව් අවශ්‍යද? මට දන්වන්න!`;
    }
    return `ආයුබෝවන්! මම **Omini**, OmniPlus+ හි ඔබගේ AI සහායකයා. 

මම ඔබට උදව් කළ හැකි කරුණු:
* **Google Maps Leads Scraping**: ප්‍රදේශ/ZIP කේත හරහා දහස් ගණන් leads ලබා ගැනීම.
* **WhatsApp Anti-Ban Pacing**: ගිණුම් ban නොවී පණිවිඩ යැවීම.
* **Cold Email Templates**: වැඩි ප්‍රතිචාර ලැබෙන cold emails ලිවීම.
* **Social Media Enrichment**: වෙබ් අඩවි නැති ව්‍යාපාර සඳහා සමාජ මාධ්‍ය සෙවීම.

ඔබට අවශ්‍ය කුමන කරුණ පිළිබඳවද?`;
  }

  if (isSpanish) {
    return `### 🚀 Asistente Omini para OmniPlus+

Estoy listo para ayudarte con:
* **Estrategias de Scraping en Google Maps**: Superar el límite de 120 resultados con matrices de códigos postales.
* **Prevención de Bloqueos en WhatsApp**: Retrasos seguros de 35 a 75 segundos y calentamiento progresivo de cuentas.
* **Redacción de Cold Emails de Alto Impacto**: Plantillas cortas y personalizadas con más del 50% de tasa de apertura.

¿En qué campaña o herramienta estás trabajando ahora?`;
  }

  // English fallback
  if (p.includes("pitch") || p.includes("whatsapp") || route.includes("whatsapp")) {
    return `### 🛡️ Omini Anti-Ban & High-Converting WhatsApp Guide

Here is a battle-tested approach to scale your WhatsApp outreach without risking account restrictions:

#### 1. Pacing & Delay Limits
* **Delay**: Set minimum **35s to 75s** randomized delays between outbound chats.
* **Batch Size**: For accounts younger than 30 days, cap daily messages at **40–60/day**. For seasoned accounts (3+ months), keep it under **150–200/day**.
* **Peer-to-Peer Warmup**: Use our **WhatsApp Warmer Engine** to build bidirectional chat karma before initiating mass broadcasts.

#### 2. Spintax Sample Template
\`\`\`text
{Hi|Hello|Hey} {{Name}}, {saw your business on Google|noticed your profile online}. {Quick question about your services|Wanted to ask if you're taking new clients}?
\`\`\`

#### 3. Best Practices
* Always clean numbers first using the **WhatsApp Number Filter**.
* Grab only active group participants via **Active Group Members Grabber** to avoid inactive ghost contacts.`;
  }

  if (p.includes("email") || p.includes("cold") || route.includes("mail")) {
    return `### ✉️ Omini High-Converting Cold Email Blueprint

Cold email success is 80% deliverability and 20% copy. Here is the framework:

#### 1. The 3-Sentence Cold Email Formula
\`\`\`text
Subject: Quick question regarding {{BusinessName}}

Hi {{Name}},

Saw that you run {{BusinessName}} in {{City}}. Most businesses in your sector struggle with acquiring consistent qualified leads each week.

We built a lightweight automation tool that extracts local leads and enriches their verified contacts in under 2 minutes. 

Would you be against a 3-minute video showing how it works for {{BusinessName}}?
\`\`\`

#### 2. Technical Deliverability Checklist
* Run addresses through our **Email Verifier** to purge honeypots and hard bounces.
* Ensure your sending domain has valid **SPF, DKIM, and DMARC** DNS records.
* Avoid spam trigger words (*Free, Guarantee, 100%, Buy Now*).`;
  }

  if (p.includes("map") || p.includes("scrape") || route.includes("gmap")) {
    return `### 📍 Omini High-Yield Google Maps Extraction Tactics

Single Google Maps queries cap at ~120 results. Here is how our **Maps Grid Matrix Scraper** multiplies your lead volume by 10x:

1. **Sub-Locality Subdivision**:
   * Instead of searching just *"Dentists in London"*, enter:
   * **Primary Query**: \`Dentists\`
   * **Sub-Localities / Postal Codes**: \`Croydon, Bromley, Wandsworth, Fulham, Camden, Greenwich\`
2. **De-duplication**: The engine automatically aggregates and deduplicates business phone numbers and names across all sub-queries.
3. **No-Website Enrichment**: Pipe results directly into **Social Enricher** to surface Facebook, Instagram, and LinkedIn contact details for businesses without websites.`;
  }

  return `### 👋 Hello! I'm Omini, your AI Growth Companion.

I'm aware that you're currently in: **${getRouteContext(route)}**.

Here's how I can accelerate your results today:
* **Cold Outreach Copy**: Generating high-converting cold email and WhatsApp scripts with Spintax variables.
* **Anti-Ban Safety Protocols**: Recommended delays, batch sizes, and warmup strategies for your WhatsApp accounts.
* **Lead Scraping Matrices**: Structuring sub-locality and ZIP code matrices to pull thousands of local leads from Google Maps.
* **Deliverability Audits**: Diagnosing bounce risks and improving domain reputation.

How can I help with your current campaign?`;
}

/**
 * Handle chat conversation turn
 */
export async function handleOminiChat({ messages = [], currentRoute = "" }) {
  const routeContext = getRouteContext(currentRoute);
  const lastUserMsg = messages[messages.length - 1]?.content || "";

  // 1. Check for Gemini API key
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const contents = [
        {
          role: "user",
          parts: [{ text: `${SYSTEM_INSTRUCTION}\n\n[USER CURRENT PAGE CONTEXT: ${routeContext}]` }],
        },
      ];

      for (const m of messages) {
        contents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        });
      }

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        { contents },
        { timeout: 18000 }
      );

      const candidate = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (candidate) {
        return { text: candidate, model: "gemini-1.5-flash", source: "ai" };
      }
    } catch (err) {
      logger.warn("OMINI_AI", `Gemini API call failed, falling back to local engine: ${err.message}`);
    }
  }

  // 2. Check for Groq API key
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const apiMessages = [
        { role: "system", content: `${SYSTEM_INSTRUCTION}\n\n[USER CURRENT PAGE CONTEXT: ${routeContext}]` },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "llama-3.1-8b-instant",
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 1024,
        },
        {
          headers: { Authorization: `Bearer ${groqKey}` },
          timeout: 18000,
        }
      );

      const reply = response.data?.choices?.[0]?.message?.content;
      if (reply) {
        return { text: reply, model: "llama-3.1-8b-instant", source: "ai" };
      }
    } catch (err) {
      logger.warn("OMINI_AI", `Groq API call failed: ${err.message}`);
    }
  }

  // 3. Fallback to specialized local knowledge engine
  const localReply = generateLocalResponse(lastUserMsg, currentRoute);
  return {
    text: localReply,
    model: "omini-expert-local",
    source: "local-knowledge-base",
  };
}
