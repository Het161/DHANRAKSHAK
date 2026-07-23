import { en, type Dictionary } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";

import type { Language } from "@/lib/types";

export type { Dictionary, MessageKey } from "./en";

// `en` is `as const`, so its values are literal types; widening to Dictionary is
// what lets the three languages share one registry.
export const dictionaries: Record<Language, Dictionary> = { en, hi, gu };

/** Gujarati first: this product is built for Gujarat before anywhere else. */
export const LANGUAGE_ORDER: Language[] = ["gu", "hi", "en"];
