/**
 * Fuzzy Clock — hand port of `fuzzyclock/fuzzy_clock.star` (by Max
 * Timkovich), kept structurally line-for-line: same dialect tables,
 * 5-minute rounding and staircase indentation.
 *
 * Screen sizes: the staircase sits top-left in a 64x32 panel like the
 * original; taller panels center it vertically and 128-wide panels step up
 * to the 6x13 font.
 */

import {
  Column,
  Config,
  Padding,
  Root,
  Text,
  schema,
  type RootSpec,
  type Schema,
} from "@koiosdigital/matrx-sdk";
import { time } from "@koiosdigital/matrx-sdk/stdlib";

const DEFAULT_TIMEZONE = "US/Eastern";

const numbersPerLang: Record<string, Record<number, string>> = {
  "nl-NL": {
    1: "ÉÉN", 2: "TWEE", 3: "DRIE", 4: "VIER", 5: "VIJF", 6: "ZES",
    7: "ZEVEN", 8: "ACHT", 9: "NEGEN", 10: "TIEN", 11: "ELF", 12: "TWAALF",
  },
  "de-DE": {
    1: "EINS", 2: "ZWEI", 3: "DREI", 4: "VIER", 5: "FÜNF", 6: "SECHS",
    7: "SIEBEN", 8: "ACHT", 9: "NEUN", 10: "ZEHN", 11: "ELF", 12: "ZWÖLF",
  },
  "en-US": {
    1: "ONE", 2: "TWO", 3: "THREE", 4: "FOUR", 5: "FIVE", 6: "SIX",
    7: "SEVEN", 8: "EIGHT", 9: "NINE", 10: "TEN", 11: "ELEVEN", 12: "TWELVE",
  },
};
numbersPerLang["en-GB"] = numbersPerLang["en-US"];
numbersPerLang["nl-BE"] = numbersPerLang["nl-NL"];
numbersPerLang["de-AT"] = numbersPerLang["de-DE"];
numbersPerLang["de-DE-alt"] = numbersPerLang["de-DE"];
numbersPerLang["de-DE-alt2"] = numbersPerLang["de-DE"];
numbersPerLang["de-CH"] = numbersPerLang["de-DE"];
numbersPerLang["de-CH-alt"] = numbersPerLang["de-DE"];

const patternsPerLang: Record<string, Record<number, string>> = {
  "de-AT": {
    0: "{hour},UHR",
    5: "FÜNF,ÜBER,{hour}",
    10: "ZEHN,ÜBER,{hour}",
    15: "VIERTEL,ÜBER,{hour}",
    20: "ZEHN,VOR HALB,{next_hour}",
    25: "FÜNF,VOR HALB,{next_hour}",
    30: "HALB,{next_hour}",
    35: "FÜNF,NACH HALB,{next_hour}",
    40: "ZEHN,NACH HALB,{next_hour}",
    45: "VIERTEL,VOR,{next_hour}",
    50: "ZEHN,VOR,{next_hour}",
    55: "FÜNF,VOR,{next_hour}",
  },
  "de-CH": {
    0: "{hour},UHR",
    5: "FÜNF,AB,{hour}",
    10: "ZEHN,AB,{hour}",
    15: "VIERTEL,AB,{hour}",
    20: "ZEHN,VOR HALB,{next_hour}",
    25: "FÜNF,VOR HALB,{next_hour}",
    30: "HALB,{next_hour}",
    35: "FÜNF,NACH HALB,{next_hour}",
    40: "ZEHN,NACH HALB,{next_hour}",
    45: "VIERTEL,VOR,{next_hour}",
    50: "ZEHN,VOR,{next_hour}",
    55: "FÜNF,VOR,{next_hour}",
  },
  "de-CH-alt": {
    0: "{hour},UHR",
    5: "FÜNF,AB,{hour}",
    10: "ZEHN,AB,{hour}",
    15: "VIERTEL,AB,{hour}",
    20: "ZWANZIG,AB,{hour}",
    25: "FÜNF,VOR HALB,{next_hour}",
    30: "HALB,{next_hour}",
    35: "FÜNF,NACH HALB,{next_hour}",
    40: "ZWANZIG,VOR {next_hour}",
    45: "VIERTEL,VOR {next_hour}",
    50: "ZEHN,VOR,{next_hour}",
    55: "FÜNF,VOR,{next_hour}",
  },
  "de-DE": {
    0: "{hour},UHR",
    5: "FÜNF,NACH {hour}",
    10: "ZEHN,NACH {hour}",
    15: "VIERTEL,NACH,{hour}",
    20: "ZEHN,VOR HALB,{next_hour}",
    25: "FÜNF,VOR HALB,{next_hour}",
    30: "HALB,{next_hour}",
    35: "FÜNF,NACH HALB,{next_hour}",
    40: "ZEHN,NACH HALB,{next_hour}",
    45: "VIERTEL,VOR,{next_hour}",
    50: "ZEHN,VOR,{next_hour}",
    55: "FÜNF,VOR,{next_hour}",
  },
  "de-DE-alt": {
    0: "{hour},UHR",
    5: "FÜNF,NACH,{hour}",
    10: "ZEHN,NACH,{hour}",
    15: "VIERTEL,NACH,{hour}",
    20: "ZWANZIG,NACH,{hour}",
    25: "FÜNF,VOR HALB,{next_hour}",
    30: "HALB,{next_hour}",
    35: "FÜNF,NACH HALB,{next_hour}",
    40: "ZWANZIG,VOR,{next_hour}",
    45: "VIERTEL,VOR,{next_hour}",
    50: "ZEHN,VOR,{next_hour}",
    55: "FÜNF,VOR,{next_hour}",
  },
  "de-DE-alt2": {
    0: "{hour},UHR",
    5: "FÜNF,NACH,{hour}",
    10: "ZEHN,NACH,{hour}",
    15: "VIERTEL,{next_hour}",
    20: "ZEHN,VOR HALB,{next_hour}",
    25: "FÜNF,VOR HALB,{next_hour}",
    30: "HALB,{next_hour}",
    35: "FÜNF,NACH HALB,{next_hour}",
    40: "FÜNF VOR,DREIVIERTEL,{next_hour}",
    45: "DREI,VIERTEL,{next_hour}",
    50: "ZEHN,VOR,{next_hour}",
    55: "FÜNF,VOR,{next_hour}",
  },
  "en-US": {
    0: "{hour},O’CLOCK",
    5: "FIVE,PAST,{hour}",
    10: "TEN,PAST,{hour}",
    15: "QUARTER,PAST,{hour}",
    20: "TWENTY,PAST,{hour}",
    25: "TWENTY-FIVE,PAST,{hour}",
    30: "HALF,PAST,{hour}",
    35: "TWENTY-FIVE,TILL,{next_hour}",
    40: "TWENTY,TILL,{next_hour}",
    45: "QUARTER,TILL,{next_hour}",
    50: "TEN,TILL,{next_hour}",
    55: "FIVE,TILL,{next_hour}",
  },
  "en-GB": {
    0: "{hour},O’CLOCK",
    5: "FIVE,PAST,{hour}",
    10: "TEN,PAST,{hour}",
    15: "QUARTER,PAST,{hour}",
    20: "TWENTY,PAST,{hour}",
    25: "TWENTY-FIVE,PAST,{hour}",
    30: "HALF,PAST,{hour}",
    35: "TWENTY-FIVE,TO,{next_hour}",
    40: "TWENTY,TO,{next_hour}",
    45: "QUARTER,TO,{next_hour}",
    50: "TEN,TO,{next_hour}",
    55: "FIVE,TO,{next_hour}",
  },
  "nl-BE": {
    0: "{hour} UUR",
    5: "VIJF,NA,{hour}",
    10: "TIEN,NA,{hour}",
    15: "KWART,NA,{hour}",
    20: "TIEN,VOOR HALF,{next_hour}",
    25: "VIJF,VOOR HALF,{next_hour}",
    30: "HALF,{next_hour}",
    35: "VIJF,NA HALF,{next_hour}",
    40: "TIEN,NA HALF,{next_hour}",
    45: "KWART,VOOR,{next_hour}",
    50: "TIEN,VOOR,{next_hour}",
    55: "VIJF,VOOR,{next_hour}",
  },
  "nl-NL": {
    0: "{hour},UUR",
    5: "VIJF,OVER,{hour}",
    10: "TIEN,OVER,{hour}",
    15: "KWART,OVER,{hour}",
    20: "TIEN,VOOR HALF,{next_hour}",
    25: "VIJF,VOOR HALF,{next_hour}",
    30: "HALF,{next_hour}",
    35: "VIJF,OVER HALF,{next_hour}",
    40: "TIEN,OVER HALF,{next_hour}",
    45: "KWART,VOOR,{next_hour}",
    50: "TIEN,VOOR,{next_hour}",
    55: "VIJF,VOOR,{next_hour}",
  },
};

/** Hour to display: 12h format with 12 instead of 0. */
function displayHour(hour: number): number {
  if (hour > 12) hour -= 12;
  if (hour === 0) hour = 12;
  return hour;
}

function fuzzyTime(hours: number, minutes: number, language: string): string[] {
  const numbers = numbersPerLang[language];
  const patterns = patternsPerLang[language];

  // Round up to the next 5 minutes.
  const rounded = Math.floor(((minutes + 2) % 60) / 5) * 5;
  if (minutes > 55 && rounded === 0) hours += 1;

  const pattern = patterns[rounded];
  let curHour = numbers[displayHour(hours)];
  const nextHour = numbers[displayHour(hours + 1)];

  // Special case: "EIN UHR" instead of "EINS UHR".
  if (language.startsWith("de") && curHour === "EINS" && rounded === 0) {
    curHour = "EIN";
  }

  return pattern.replace("{hour}", curHour).replace("{next_hour}", nextHour).split(",");
}

export default function render(config: Config): RootSpec {
  const locationRaw = config.get("location");
  let timezone = DEFAULT_TIMEZONE;
  if (locationRaw) {
    try {
      timezone = (JSON.parse(locationRaw) as { timezone?: string }).timezone ?? DEFAULT_TIMEZONE;
    } catch {
      // keep default
    }
  }
  const now = time.now().inLocation(timezone);

  let language = config.get("dialect") || "en-US";
  // Backwards compatibility.
  if (language === "american") language = "en-US";
  else if (language === "british") language = "en-GB";
  if (!(language in patternsPerLang)) language = "en-US";

  const fuzzed = fuzzyTime(now.hour, now.minute, language);

  const font = config.width() >= 128 ? "6x13" : "tb-8";

  // Add some left padding for ~style~.
  const texts = fuzzed.map((s, i) => Text({ content: " ".repeat(i) + s, font }));

  return Root({
    maxAge: 120,
    child: Padding({
      pad: 4,
      child: Column({
        // Taller panels center the staircase; 64x32 keeps the original look.
        expanded: config.height() > 32,
        mainAlign: "center",
        children: texts,
      }),
    }),
  });
}

export function getSchema(): Schema {
  const dialectOptions = [
    schema.option({ display: "American English", value: "en-US" }),
    schema.option({ display: "British English", value: "en-GB" }),
    schema.option({ display: "Deutsch", value: "de-DE" }),
    schema.option({ display: "Deutsch (Österreich)", value: "de-AT" }),
    schema.option({ display: "Deutsch (Alternative)", value: "de-DE-alt" }),
    schema.option({ display: "Deutsch (Alternative 2)", value: "de-DE-alt2" }),
    schema.option({ display: "Deutsch (Schweiz)", value: "de-CH" }),
    schema.option({ display: "Deutsch (Schweiz, Alternative)", value: "de-CH-alt" }),
    schema.option({ display: "Dutch", value: "nl-NL" }),
    schema.option({ display: "Dutch (Belgium)", value: "nl-BE" }),
  ];

  return schema.schema({
    version: "1",
    fields: [
      schema.location({
        id: "location",
        name: "Location",
        icon: "locationDot",
        desc: "Location for which to display time",
      }),
      schema.dropdown({
        id: "dialect",
        name: "Language",
        icon: "language",
        desc: "Language in which to display time",
        default: dialectOptions[0].value,
        options: dialectOptions,
      }),
    ],
  });
}
