import type { SupportedLanguage } from "./status-page-translations";
import { z } from "zod";

export type StatusPageSupportContact = {
  kind: "email" | "url";
  href: string;
  value: string;
};

const SUPPORT_CTA_LABELS = {
  en: "Get in touch",
  ar: "تواصل معنا",
  cs: "Kontaktujte nás",
  da: "Kontakt os",
  de: "Kontakt aufnehmen",
  es: "Ponte en contacto",
  fi: "Ota yhteyttä",
  fr: "Nous contacter",
  hi: "संपर्क करें",
  hr: "Javite nam se",
  hu: "Kapcsolatfelvétel",
  it: "Contattaci",
  ja: "お問い合わせ",
  ko: "문의하기",
  nl: "Neem contact op",
  no: "Ta kontakt",
  pl: "Skontaktuj się",
  pt: "Entrar em contato",
  ro: "Contactați-ne",
  ru: "Связаться с нами",
  sv: "Kontakta oss",
  tr: "İletişime geçin",
  uk: "Зв'яжіться з нами",
  zh: "联系我们",
} satisfies Record<SupportedLanguage, string>;

const SUPPORT_CONTACT_ERROR =
  "Please enter a valid support website URL or email address";
const MAILTO_PROTOCOL = "mailto:";
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const EMAIL_ADDRESS_SCHEMA = z.string().email(SUPPORT_CONTACT_ERROR);

function parseEmailAddress(value: string): string | null {
  const result = EMAIL_ADDRESS_SCHEMA.safeParse(value.trim());
  return result.success ? result.data : null;
}

export function getStatusPageSupportContact(
  value: string | null | undefined
): StatusPageSupportContact | null {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  const emailAddress = parseEmailAddress(trimmedValue);
  if (emailAddress) {
    return {
      kind: "email",
      href: `${MAILTO_PROTOCOL}${emailAddress}`,
      value: emailAddress,
    };
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (parsedUrl.protocol === MAILTO_PROTOCOL) {
      const mailtoAddress = decodeURIComponent(parsedUrl.pathname).trim();
      const normalizedEmail = parseEmailAddress(mailtoAddress);

      if (!normalizedEmail) {
        return null;
      }

      return {
        kind: "email",
        href: parsedUrl.toString(),
        value: normalizedEmail,
      };
    }

    if (!HTTP_PROTOCOLS.has(parsedUrl.protocol)) {
      return null;
    }

    return {
      kind: "url",
      href: parsedUrl.toString(),
      value: parsedUrl.toString(),
    };
  } catch {
    return null;
  }
}

export function normalizeStatusPageSupportContact(
  value: string | null | undefined
): string | null {
  return getStatusPageSupportContact(value)?.href ?? null;
}

export function getStatusPageSupportContactInputValue(
  value: string | null | undefined
): string {
  return getStatusPageSupportContact(value)?.value ?? "";
}

export function getStatusPageSupportCtaLabel(language?: string | null): string {
  const normalizedLanguage = language?.split("-")[0]?.toLowerCase();

  if (normalizedLanguage && normalizedLanguage in SUPPORT_CTA_LABELS) {
    return SUPPORT_CTA_LABELS[normalizedLanguage as SupportedLanguage];
  }

  return SUPPORT_CTA_LABELS.en;
}

export const statusPageSupportContactSchema = z
  .string()
  .trim()
  .max(500, "Support contact is too long")
  .refine(
    (value) => !value || getStatusPageSupportContact(value) !== null,
    SUPPORT_CONTACT_ERROR
  );
